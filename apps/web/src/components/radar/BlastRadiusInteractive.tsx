import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";

// ── Data ──────────────────────────────────────────────────────────────────────

interface AppData {
  id: string;
  name: string;
  risk: "critical" | "high" | "medium" | "low";
  groups: string[];
}

interface GroupData {
  id: string;
  name: string;
  color: string;
  users: { initials: string; name: string }[];
}

const RISK = {
  critical: { color: "#e24b4a", r: 34, label: "Critical" },
  high:     { color: "#ef9f27", r: 30, label: "High" },
  medium:   { color: "#639922", r: 26, label: "Medium" },
  low:      { color: "#378add", r: 26, label: "Low" },
};

const GROUPS: Record<string, GroupData> = {
  it_admins:   { id: "it_admins",   name: "IT Admins",   color: "#06b6d4", users: [{ initials: "JD", name: "John" }, { initials: "SM", name: "Sara" }, { initials: "AK", name: "Alex" }] },
  engineering: { id: "engineering", name: "Engineering", color: "#8b5cf6", users: [{ initials: "MR", name: "Mike" }, { initials: "LP", name: "Lisa" }, { initials: "TC", name: "Tom" }, { initials: "NK", name: "Nina" }, { initials: "RJ", name: "Raj" }] },
  sales:       { id: "sales",       name: "Sales",       color: "#ec4899", users: [{ initials: "BW", name: "Bob" }, { initials: "KL", name: "Kate" }, { initials: "DM", name: "Dan" }, { initials: "EM", name: "Emma" }] },
  finance:     { id: "finance",     name: "Finance",     color: "#f59e0b", users: [{ initials: "GH", name: "Grace" }, { initials: "PL", name: "Paul" }, { initials: "YT", name: "Yuki" }] },
  hr:          { id: "hr",          name: "HR",          color: "#10b981", users: [{ initials: "OL", name: "Olivia" }, { initials: "CH", name: "Chris" }, { initials: "FD", name: "Fred" }, { initials: "ZL", name: "Zara" }, { initials: "WN", name: "Wendy" }, { initials: "HK", name: "Hank" }] },
  marketing:   { id: "marketing",   name: "Marketing",   color: "#f97316", users: [{ initials: "JN", name: "Jane" }, { initials: "RB", name: "Rob" }, { initials: "AL", name: "Ali" }] },
};

const APPS: AppData[] = [
  { id: "chrome",  name: "Google Chrome",  risk: "critical", groups: ["it_admins", "engineering", "sales", "finance"] },
  { id: "java",    name: "Java Runtime",   risk: "critical", groups: ["engineering", "finance"] },
  { id: "acrobat", name: "Adobe Acrobat",  risk: "critical", groups: ["sales", "finance", "hr", "marketing"] },
  { id: "zoom",    name: "Zoom",           risk: "high",     groups: ["it_admins", "engineering", "sales", "hr"] },
  { id: "slack",   name: "Slack",          risk: "high",     groups: ["engineering", "marketing"] },
  { id: "teams",   name: "MS Teams",       risk: "high",     groups: ["it_admins", "sales", "hr", "finance"] },
  { id: "7zip",    name: "7-Zip",          risk: "medium",   groups: ["engineering", "it_admins"] },
  { id: "vlc",     name: "VLC Player",     risk: "medium",   groups: ["engineering", "marketing"] },
  { id: "notepad", name: "Notepad++",      risk: "medium",   groups: ["engineering", "it_admins"] },
  { id: "putty",   name: "PuTTY",          risk: "medium",   groups: ["it_admins", "engineering"] },
  { id: "winrar",  name: "WinRAR",         risk: "low",      groups: ["sales", "finance"] },
  { id: "git",     name: "Git",            risk: "low",      groups: ["engineering"] },
  { id: "vscode",  name: "VS Code",        risk: "low",      groups: ["engineering", "it_admins"] },
];

// ── Component ─────────────────────────────────────────────────────────────────

type Layer = "apps" | "groups" | "users";

export function BlastRadiusInteractive() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [layer, setLayer] = useState<Layer>("apps");
  const [selectedApp, setSelectedApp] = useState<AppData | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupData | null>(null);
  const [info, setInfo] = useState("Click any vulnerable app to trace its blast radius");
  const [dim, setDim] = useState({ w: 960, h: 560 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable positions for apps so they don't shuffle on re-render
  const appPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDim({ w: el.clientWidth, h: 560 });
    });
    ro.observe(el);
    setDim({ w: el.clientWidth, h: 560 });
    return () => ro.disconnect();
  }, []);

  // Compute app positions once
  useEffect(() => {
    if (appPositions.current.size > 0) return;
    const { w, h } = dim;
    const m = 80;
    const cols = Math.ceil(Math.sqrt(APPS.length * (w / h)));
    const rows = Math.ceil(APPS.length / cols);
    const cw = (w - m * 2) / cols;
    const ch = (h - m * 2) / rows;
    APPS.forEach((app, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      appPositions.current.set(app.id, {
        x: m + col * cw + cw / 2 + (Math.sin(i * 7.3) * cw * 0.15),
        y: m + row * ch + ch / 2 + (Math.cos(i * 5.1) * ch * 0.15),
      });
    });
  }, [dim]);

  const selectApp = useCallback((app: AppData) => {
    setSelectedApp(app);
    setSelectedGroup(null);
    setLayer("groups");
    const totalUsers = app.groups.reduce((s, gid) => s + (GROUPS[gid]?.users.length ?? 0), 0);
    setInfo(`${app.name} (${RISK[app.risk].label}) → ${app.groups.length} groups, ${totalUsers} users exposed`);
  }, []);

  const selectGroup = useCallback((group: GroupData) => {
    setSelectedGroup(group);
    setLayer("users");
    setInfo(`${group.name} → ${group.users.length} users directly affected`);
  }, []);

  const goBack = useCallback(() => {
    if (layer === "users") {
      setSelectedGroup(null);
      setLayer("groups");
      if (selectedApp) {
        const totalUsers = selectedApp.groups.reduce((s, gid) => s + (GROUPS[gid]?.users.length ?? 0), 0);
        setInfo(`${selectedApp.name} → ${selectedApp.groups.length} groups, ${totalUsers} users exposed`);
      }
    } else if (layer === "groups") {
      setSelectedApp(null);
      setLayer("apps");
      setInfo("Click any vulnerable app to trace its blast radius");
    }
  }, [layer, selectedApp]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const { w, h } = dim;
  const cx = w / 2;
  const cy = h / 2;

  // Compute viewBox for zoom effect
  let viewBox = `0 0 ${w} ${h}`;
  let zoomTarget: { x: number; y: number } | null = null;

  if (layer === "groups" && selectedApp) {
    const pos = appPositions.current.get(selectedApp.id);
    if (pos) zoomTarget = pos;
  }

  // Group positions (radial around selected app)
  const groupPos = new Map<string, { x: number; y: number }>();
  if (selectedApp && zoomTarget) {
    const gids = selectedApp.groups;
    const aStep = (2 * Math.PI) / gids.length;
    const gr = 160;
    gids.forEach((gid, i) => {
      const a = aStep * i - Math.PI / 2;
      groupPos.set(gid, {
        x: zoomTarget!.x + Math.cos(a) * gr,
        y: zoomTarget!.y + Math.sin(a) * gr,
      });
    });
  }

  // User positions (radial around selected group)
  const userPos: { x: number; y: number }[] = [];
  if (selectedGroup) {
    const gp = groupPos.get(selectedGroup.id) ?? { x: cx, y: cy };
    const users = selectedGroup.users;
    const aStep = (2 * Math.PI) / users.length;
    const ur = 110;
    users.forEach((_, i) => {
      const a = aStep * i - Math.PI / 2;
      userPos.push({ x: gp.x + Math.cos(a) * ur, y: gp.y + Math.sin(a) * ur });
    });
  }

  // Compute viewBox to zoom into area of interest
  if (layer === "groups" && zoomTarget) {
    const pad = 220;
    const zx = zoomTarget.x - pad;
    const zy = zoomTarget.y - pad;
    const zw = pad * 2;
    const zh = pad * 2;
    viewBox = `${zx} ${zy} ${zw} ${zh}`;
  }

  if (layer === "users" && selectedGroup) {
    const gp = groupPos.get(selectedGroup.id);
    if (gp) {
      const pad = 180;
      viewBox = `${gp.x - pad} ${gp.y - pad} ${pad * 2} ${pad * 2}`;
    }
  }

  return (
    <div className="space-y-3">
      {layer !== "apps" && (
        <button onClick={goBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      <div ref={containerRef} className="w-full rounded-xl overflow-hidden border border-border relative">
        <svg
          ref={svgRef}
          width={w}
          height={h}
          viewBox={viewBox}
          className="block"
          style={{ transition: "viewBox 0.6s", background: "#0a0d14" }}
          onClick={goBack}
        >
          {/* Smooth viewBox transition via CSS on the inner group */}
          <g style={{ transition: "transform 0.5s ease-in-out" }}>

            {/* LAYER 1: All app bubbles (always rendered, dimmed when drilled) */}
            {APPS.map((app) => {
              const pos = appPositions.current.get(app.id);
              if (!pos) return null;
              const cfg = RISK[app.risk];
              const isSelected = selectedApp?.id === app.id;
              const dimmed = layer !== "apps" && !isSelected;

              return (
                <g
                  key={app.id}
                  onClick={(e) => { e.stopPropagation(); if (layer === "apps") selectApp(app); }}
                  style={{ cursor: layer === "apps" ? "pointer" : "default", transition: "opacity 0.4s" }}
                  opacity={dimmed ? 0.08 : 1}
                >
                  {/* Pulse ring */}
                  {!dimmed && (
                    <circle cx={pos.x} cy={pos.y} r={cfg.r + 6} fill="none"
                      stroke={cfg.color} strokeWidth={1} opacity={0.25}>
                      <animate attributeName="r" from={cfg.r + 4} to={cfg.r + 10} dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={pos.x} cy={pos.y} r={cfg.r} fill={`${cfg.color}18`} stroke={cfg.color} strokeWidth={2} />
                  <text x={pos.x} y={pos.y - 5} textAnchor="middle" fill="#e4e4e7" fontSize={10}
                    fontFamily="Inter, system-ui, sans-serif" fontWeight="500">
                    {app.name.length > 14 ? app.name.slice(0, 12) + ".." : app.name}
                  </text>
                  <text x={pos.x} y={pos.y + 10} textAnchor="middle" fill={cfg.color} fontSize={8}
                    fontFamily="Inter, system-ui, sans-serif" fontWeight="600">
                    {cfg.label}
                  </text>
                </g>
              );
            })}

            {/* LAYER 2: Flow lines + group bubbles (when app selected) */}
            {layer !== "apps" && selectedApp && zoomTarget && selectedApp.groups.map((gid, i) => {
              const group = GROUPS[gid];
              const gp = groupPos.get(gid);
              if (!group || !gp) return null;
              const dimmedGroup = layer === "users" && selectedGroup?.id !== gid;

              return (
                <g key={gid} style={{ transition: "opacity 0.4s" }} opacity={dimmedGroup ? 0.15 : 1}>
                  {/* Animated dashed flow line with arrow */}
                  <line
                    x1={zoomTarget.x} y1={zoomTarget.y} x2={gp.x} y2={gp.y}
                    stroke={group.color} strokeWidth={1.5}
                    strokeDasharray="6 4" opacity={0.5}
                  >
                    <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1.5s" repeatCount="indefinite" />
                  </line>
                  {/* Arrow */}
                  {(() => {
                    const angle = Math.atan2(gp.y - zoomTarget.y, gp.x - zoomTarget.x);
                    const ex = gp.x - Math.cos(angle) * 30;
                    const ey = gp.y - Math.sin(angle) * 30;
                    const a1x = ex - 7 * Math.cos(angle - 0.4);
                    const a1y = ey - 7 * Math.sin(angle - 0.4);
                    const a2x = ex - 7 * Math.cos(angle + 0.4);
                    const a2y = ey - 7 * Math.sin(angle + 0.4);
                    return <polygon points={`${ex},${ey} ${a1x},${a1y} ${a2x},${a2y}`} fill={group.color} opacity={0.6} />;
                  })()}
                  {/* Group bubble */}
                  <g
                    onClick={(e) => { e.stopPropagation(); if (layer === "groups") selectGroup(group); }}
                    style={{ cursor: layer === "groups" ? "pointer" : "default" }}
                  >
                    <circle cx={gp.x} cy={gp.y} r={26} fill={`${group.color}15`} stroke={group.color} strokeWidth={2} />
                    <text x={gp.x} y={gp.y - 4} textAnchor="middle" fill="#e4e4e7" fontSize={9}
                      fontFamily="Inter, system-ui, sans-serif" fontWeight="500">
                      {group.name}
                    </text>
                    <text x={gp.x} y={gp.y + 9} textAnchor="middle" fill="#71717a" fontSize={8}
                      fontFamily="Inter, system-ui, sans-serif">
                      {group.users.length} users
                    </text>
                  </g>
                </g>
              );
            })}

            {/* LAYER 3: Flow lines + user bubbles (when group selected) */}
            {layer === "users" && selectedGroup && (() => {
              const gp = groupPos.get(selectedGroup.id);
              if (!gp) return null;
              return selectedGroup.users.map((user, i) => {
                const up = userPos[i];
                if (!up) return null;
                return (
                  <g key={user.initials + i}>
                    <line
                      x1={gp.x} y1={gp.y} x2={up.x} y2={up.y}
                      stroke={selectedGroup.color} strokeWidth={1.2}
                      strokeDasharray="4 3" opacity={0.4}
                    >
                      <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.2s" repeatCount="indefinite" />
                    </line>
                    {/* Arrow */}
                    {(() => {
                      const angle = Math.atan2(up.y - gp.y, up.x - gp.x);
                      const ex = up.x - Math.cos(angle) * 22;
                      const ey = up.y - Math.sin(angle) * 22;
                      const a1x = ex - 6 * Math.cos(angle - 0.4);
                      const a1y = ey - 6 * Math.sin(angle - 0.4);
                      const a2x = ex - 6 * Math.cos(angle + 0.4);
                      const a2y = ey - 6 * Math.sin(angle + 0.4);
                      return <polygon points={`${ex},${ey} ${a1x},${a1y} ${a2x},${a2y}`} fill={selectedGroup.color} opacity={0.5} />;
                    })()}
                    {/* User bubble */}
                    <circle cx={up.x} cy={up.y} r={18} fill={`${selectedGroup.color}12`} stroke={selectedGroup.color} strokeWidth={1.5} />
                    <text x={up.x} y={up.y - 3} textAnchor="middle" fill="#e4e4e7" fontSize={10}
                      fontFamily="Inter, system-ui, sans-serif" fontWeight="600">
                      {user.initials}
                    </text>
                    <text x={up.x} y={up.y + 9} textAnchor="middle" fill="#71717a" fontSize={7}
                      fontFamily="Inter, system-ui, sans-serif">
                      {user.name}
                    </text>
                  </g>
                );
              });
            })()}

          </g>

          {/* Legend (always visible, fixed position) */}
          {layer === "apps" && (
            <g>
              {Object.entries(RISK).map(([_, cfg], i) => (
                <g key={cfg.label}>
                  <circle cx={18} cy={20 + i * 20} r={5} fill={cfg.color} />
                  <text x={30} y={24 + i * 20} fill="#71717a" fontSize={10} fontFamily="Inter, system-ui, sans-serif">
                    {cfg.label}
                  </text>
                </g>
              ))}
            </g>
          )}
        </svg>
      </div>

      {/* Info bar */}
      <div className="bg-surface border border-border rounded-lg px-4 py-3 text-sm text-text-muted flex items-center justify-between">
        <span>{info}</span>
        {layer !== "apps" && (
          <span className="text-xs text-text-muted/50">Click background to go back</span>
        )}
      </div>
    </div>
  );
}
