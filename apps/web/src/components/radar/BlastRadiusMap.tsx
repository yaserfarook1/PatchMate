import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

interface AppNode {
  name: string;
  type: "app";
  deviceCount: number;
  installedVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  severity: "critical" | "high" | "medium" | "current";
  value: number;
}

interface GroupNode {
  name: string;
  type: "group";
  groupId: string;
  memberCount: number;
  description: string | null;
  children: AppNode[];
}

interface HierarchyData {
  name: string;
  children: GroupNode[];
}

interface Props {
  data: HierarchyData;
  width?: number;
  height?: number;
}

const GROUP_COLORS = [
  "#facc15", "#06b6d4", "#ec4899", "#10b981",
  "#8b5cf6", "#f97316", "#14b8a6", "#e879f9",
  "#84cc16", "#f43f5e", "#22d3ee", "#a78bfa",
];

const SEVERITY_GLOW = {
  critical: "rgba(239, 68, 68, 0.6)",
  high: "rgba(249, 115, 22, 0.5)",
  medium: "rgba(250, 204, 21, 0.4)",
  current: "rgba(16, 185, 129, 0.3)",
};

const SEVERITY_FILL = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#facc15",
  current: "#10b981",
};

export function BlastRadiusMap({ data, width = 900, height = 600 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [view, setView] = useState<[number, number, number]>([width / 2, height / 2, width]);

  useEffect(() => {
    if (!svgRef.current || !data?.children?.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Create circle packing layout
    const root = d3.hierarchy(data)
      .sum((d: any) => d.value || 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const pack = d3.pack<typeof data>()
      .size([width * 2.2, height * 2.2])
      .padding(200);

    pack(root as any);

    // Defs for glow filters
    const defs = svg.append("defs");

    GROUP_COLORS.forEach((color, i) => {
      const filter = defs.append("filter").attr("id", `glow-${i}`);
      filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
      filter.append("feFlood").attr("flood-color", color).attr("flood-opacity", "0.3");
      filter.append("feComposite").attr("in2", "blur").attr("operator", "in");
      const merge = filter.append("feMerge");
      merge.append("feMergeNode");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
    });

    // Glow for severity
    Object.entries(SEVERITY_GLOW).forEach(([key, color]) => {
      const filter = defs.append("filter").attr("id", `sev-${key}`);
      filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
      filter.append("feFlood").attr("flood-color", color.replace(/[\d.]+\)$/, "1)")).attr("flood-opacity", "0.4");
      filter.append("feComposite").attr("in2", "blur").attr("operator", "in");
      const merge = filter.append("feMerge");
      merge.append("feMergeNode");
      merge.append("feMergeNode").attr("in", "SourceGraphic");
    });

    // Pulsing animation filter
    const pulseFilter = defs.append("filter").attr("id", "pulse-glow");
    pulseFilter.append("feGaussianBlur").attr("stdDeviation", "6").attr("result", "blur");
    pulseFilter.append("feFlood").attr("flood-color", "#facc15").attr("flood-opacity", "0.5");
    pulseFilter.append("feComposite").attr("in2", "blur").attr("operator", "in");
    const pulseMerge = pulseFilter.append("feMerge");
    pulseMerge.append("feMergeNode");
    pulseMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const container = svg.append("g");

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .on("zoom", (event) => {
        container.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    // Draw nodes (depth-first: groups first, then apps)
    const nodes = (root as any).descendants();

    // Group circles (depth 1)
    const groupNodes = nodes.filter((d: any) => d.depth === 1);
    const appNodes = nodes.filter((d: any) => d.depth === 2);

    // Group bubbles
    container.selectAll(".group-circle")
      .data(groupNodes)
      .join("circle")
      .attr("class", "group-circle")
      .attr("cx", (d: any) => d.x)
      .attr("cy", (d: any) => d.y)
      .attr("r", (d: any) => d.r)
      .attr("fill", (_, i) => `${GROUP_COLORS[i % GROUP_COLORS.length]}08`)
      .attr("stroke", (_, i) => `${GROUP_COLORS[i % GROUP_COLORS.length]}40`)
      .attr("stroke-width", 1.5)
      .attr("filter", (_, i) => `url(#glow-${i % GROUP_COLORS.length})`)
      .style("cursor", "pointer")
      .on("click", (event, d: any) => {
        event.stopPropagation();
        setSelectedNode(d.data);
        // Zoom into group
        const k = Math.min(width, height) / (d.r * 2 + 40);
        const x = d.x;
        const y = d.y;
        svg.transition().duration(750).call(
          zoom.transform as any,
          d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-x, -y)
        );
      });

    // Group labels — above the circle
    container.selectAll(".group-label")
      .data(groupNodes)
      .join("text")
      .attr("class", "group-label")
      .attr("x", (d: any) => d.x)
      .attr("y", (d: any) => d.y - d.r - 12)
      .attr("text-anchor", "middle")
      .attr("fill", (_, i) => GROUP_COLORS[i % GROUP_COLORS.length])
      .attr("font-size", (d: any) => Math.max(10, Math.min(13, d.r / 5)))
      .attr("font-family", "Inter, system-ui, sans-serif")
      .attr("font-weight", "600")
      .attr("pointer-events", "none")
      .text((d: any) => d.data.name);

    // Member count — just below the name, still above the circle
    container.selectAll(".member-label")
      .data(groupNodes)
      .join("text")
      .attr("class", "member-label")
      .attr("x", (d: any) => d.x)
      .attr("y", (d: any) => d.y - d.r - 1)
      .attr("text-anchor", "middle")
      .attr("fill", "#a3a3a3")
      .attr("font-size", (d: any) => Math.max(8, Math.min(10, d.r / 6)))
      .attr("font-family", "Inter, system-ui, sans-serif")
      .attr("pointer-events", "none")
      .text((d: any) => `${d.data.memberCount} devices`);

    // App bubbles (scaled up 1.8x for visibility)
    const appScale = 1.8;
    container.selectAll(".app-circle")
      .data(appNodes)
      .join("circle")
      .attr("class", "app-circle")
      .attr("cx", (d: any) => d.x)
      .attr("cy", (d: any) => d.y)
      .attr("r", (d: any) => d.r * appScale)
      .attr("fill", (d: any) => {
        const sev = d.data.severity || "current";
        return SEVERITY_FILL[sev as keyof typeof SEVERITY_FILL] + "30";
      })
      .attr("stroke", (d: any) => {
        const sev = d.data.severity || "current";
        return SEVERITY_FILL[sev as keyof typeof SEVERITY_FILL] + "80";
      })
      .attr("stroke-width", 1)
      .attr("filter", (d: any) => d.data.isOutdated ? `url(#sev-${d.data.severity})` : "none")
      .style("cursor", "pointer")
      .on("click", (event, d: any) => {
        event.stopPropagation();
        setSelectedNode(d.data);
        // Zoom into app
        const k = Math.min(width, height) / (d.r * 4 + 60);
        svg.transition().duration(750).call(
          zoom.transform as any,
          d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-d.x, -d.y)
        );
      })
      .on("mouseenter", function (_, d: any) {
        d3.select(this).transition().duration(200)
          .attr("stroke-width", 2.5)
          .attr("r", (d as any).r * appScale + 3);
      })
      .on("mouseleave", function (_, d: any) {
        d3.select(this).transition().duration(200)
          .attr("stroke-width", 1)
          .attr("r", (d as any).r * appScale);
      });

    // App labels (only show for larger bubbles)
    container.selectAll(".app-label")
      .data(appNodes.filter((d: any) => d.r * appScale > 18))
      .join("text")
      .attr("class", "app-label")
      .attr("x", (d: any) => d.x)
      .attr("y", (d: any) => d.y - 2)
      .attr("text-anchor", "middle")
      .attr("fill", "#e4e4e7")
      .attr("font-size", (d: any) => Math.max(8, Math.min(14, (d.r * appScale) / 3)))
      .attr("font-family", "Inter, sans-serif")
      .attr("font-weight", "500")
      .text((d: any) => {
        const name = d.data.name;
        const max = Math.floor((d.r * appScale) / 3);
        return name.length > max ? name.slice(0, max - 1) + ".." : name;
      });

    // Device count inside app bubbles
    container.selectAll(".app-count")
      .data(appNodes.filter((d: any) => d.r * appScale > 14))
      .join("text")
      .attr("class", "app-count")
      .attr("x", (d: any) => d.x)
      .attr("y", (d: any) => d.y + 9)
      .attr("text-anchor", "middle")
      .attr("fill", "#71717a")
      .attr("font-size", 7)
      .attr("font-family", "JetBrains Mono, monospace")
      .text((d: any) => `${d.data.deviceCount}d`);

    // Click background to zoom out
    svg.on("click", () => {
      setSelectedNode(null);
      svg.transition().duration(750).call(
        zoom.transform as any,
        d3.zoomIdentity
      );
    });

  }, [data, width, height]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="w-full rounded-xl border border-border bg-background/80"
        style={{ maxHeight: "600px" }}
      />

      {/* Info panel */}
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-surface/90 backdrop-blur-xl border border-primary/20 rounded-xl p-4 w-64  animate-fade-in z-20">
          <h3 className="font-bold text-text text-sm mb-1">{selectedNode.name}</h3>
          {selectedNode.type === "group" ? (
            <div className="space-y-2 text-xs">
              <p className="text-text-muted">{selectedNode.description || "Entra Security Group"}</p>
              <div className="flex items-center gap-2 text-blue-400">
                <span className="font-mono">{selectedNode.memberCount}</span>
                <span className="text-text-muted">devices in group</span>
              </div>
              <div className="flex items-center gap-2 text-primary">
                <span className="font-mono">{selectedNode.children?.length ?? 0}</span>
                <span className="text-text-muted">apps detected</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">Installed</span>
                <span className="font-mono text-red-400">v{selectedNode.installedVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Available</span>
                <span className="font-mono text-green-400">v{selectedNode.latestVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Devices</span>
                <span className="font-mono text-primary">{selectedNode.deviceCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Risk</span>
                <span className={`font-mono ${
                  selectedNode.severity === "critical" ? "text-red-400" :
                  selectedNode.severity === "high" ? "text-orange-400" :
                  selectedNode.severity === "medium" ? "text-primary" :
                  "text-green-400"
                }`}>
                  {selectedNode.severity?.toUpperCase()}
                </span>
              </div>
              {selectedNode.isOutdated && (
                <p className="text-red-400/80 mt-1">
                  If compromised: {selectedNode.deviceCount} devices + ~{Math.round(selectedNode.deviceCount * 1.3)} users exposed
                </p>
              )}
            </div>
          )}
          <button
            onClick={() => setSelectedNode(null)}
            className="mt-3 text-[10px] text-text-muted hover:text-text"
          >
            Click background to zoom out
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 flex gap-3 text-[10px] bg-surface/80 backdrop-blur-sm border border-border rounded-lg px-3 py-2">
        {Object.entries(SEVERITY_FILL).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
            <span className="text-text-muted capitalize">{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
