import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Radar, RefreshCw, ArrowUpDown, CheckCircle2, AlertTriangle, Zap, ShieldAlert, Target } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useRadarResults, useStartRadarScan, useManageDiscoveredApp, useOutdatedApps, useBlastRadius, OutdatedApp } from "../hooks/useRadar";
import { BlastRadiusCharts } from "../components/radar/BlastRadiusCharts";
import { BlastRadiusMap } from "../components/radar/BlastRadiusMap";
import { useTenant } from "../contexts/TenantContext";
import { useCreateFlow } from "../hooks/useFlows";
import { useApps } from "../hooks/useApps";
import { getSocket } from "../lib/socket";
import { DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { StatusBadge } from "../components/ui/StatusBadge";
import { RadarScanProgressPayload } from "@autopack/shared";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "../lib/utils";

const SEVERITY_CONFIG = {
  critical: { label: "Critical", className: "bg-red-500/20 text-red-400 border border-red-500/30" },
  high: { label: "High", className: "bg-orange-500/20 text-orange-400 border border-orange-500/30" },
  medium: { label: "Medium", className: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" },
};

function SeverityBadge({ severity }: { severity: OutdatedApp["severity"] }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

export function RadarPage() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "updates" | "blast">("updates");
  const [sort, setSort] = useState("deviceCount");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useRadarResults(activeTenantId, { sort, order, page, pageSize: 20 });
  const { data: outdated, isLoading: outdatedLoading } = useOutdatedApps(activeTenantId);
  const startScan = useStartRadarScan();
  const manageApp = useManageDiscoveredApp();
  const createFlow = useCreateFlow();
  const { data: appsData } = useApps({ pageSize: 200 });
  const { data: blastData } = useBlastRadius(activeTenantId);
  const [scanningTenantId, setScanningTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTenantId) return;
    const socket = getSocket();
    socket.emit("join:radar", activeTenantId);
    socket.on("radar:scan-progress", (p: RadarScanProgressPayload) => {
      if (p.tenantId !== activeTenantId) return;
      toast.loading(`Scanning: ${p.currentApp} (${p.scanned}/${p.total})`, { id: "radar-scan" });
    });
    socket.on("radar:scan-complete", () => {
      toast.success("Radar scan complete!", { id: "radar-scan" });
      setScanningTenantId(null);
      qc.invalidateQueries({ queryKey: ["radar", activeTenantId] });
      qc.invalidateQueries({ queryKey: ["radar-outdated", activeTenantId] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    });
    return () => {
      socket.off("radar:scan-progress");
      socket.off("radar:scan-complete");
    };
  }, [activeTenantId, qc]);

  async function handleScan() {
    if (!activeTenantId) return;
    setScanningTenantId(activeTenantId);
    try {
      await startScan.mutateAsync(activeTenantId);
      toast.loading("Radar scan started...", { id: "radar-scan" });
    } catch {
      toast.error("Failed to start scan");
      setScanningTenantId(null);
    }
  }

  async function handleManage(discoveryId: string, appName: string) {
    try {
      await manageApp.mutateAsync(discoveryId);
      toast.success(`"${appName}" brought under management!`);
    } catch {
      toast.error("Failed");
    }
  }

  async function handleCreateUpdateFlow(app: OutdatedApp) {
    if (!activeTenantId) return;
    // Find the matched app in catalog
    const catalogApp = appsData?.data.find((a) => a.id === app.matchedAppId);
    if (!catalogApp) {
      toast.error("App not found in catalog — run Sync Apps first");
      return;
    }
    try {
      const flow = await createFlow.mutateAsync({
        appId: catalogApp.id,
        tenantId: activeTenantId,
        name: `${app.appName} Update Flow`,
        autoUpdate: true,
        waves: [
          { name: "Pilot",      groupId: "", delayHours: 0,  order: 1 },
          { name: "UAT",        groupId: "", delayHours: 24, order: 2 },
          { name: "Production", groupId: "", delayHours: 48, order: 3 },
        ],
      });
      toast.success(`Patch flow created for ${app.appName}`);
      navigate(`/flows/${flow.id}`);
    } catch {
      toast.error("Failed to create flow");
    }
  }

  function toggleSort(col: string) {
    if (sort === col) setOrder((o) => o === "asc" ? "desc" : "asc");
    else { setSort(col); setOrder("desc"); }
    setPage(1);
  }

  const isScanning = scanningTenantId === activeTenantId;
  const updatesCount = outdated?.total ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Radar</h1>
          <p className="text-text-muted text-sm mt-1">
            {data?.total ?? 0} apps discovered · {updatesCount} need updating
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={isScanning || startScan.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
          {isScanning ? "Scanning..." : "Start Scan"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 p-1 rounded-xl w-fit">
        <button
          onClick={() => setTab("updates")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            tab === "updates" ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
          )}
        >
          <AlertTriangle className="w-4 h-4" />
          Updates Available
          {updatesCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {updatesCount > 99 ? "99+" : updatesCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("blast")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            tab === "blast" ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
          )}
        >
          <Target className="w-4 h-4" />
          Blast Radius Map
        </button>
        <button
          onClick={() => setTab("all")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            tab === "all" ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
          )}
        >
          <Radar className="w-4 h-4" />
          All Discovered
          <span className="text-xs text-text-muted">({data?.total ?? 0})</span>
        </button>
      </div>

      {/* ── Updates Available tab ── */}
      {tab === "updates" && (
        <>
          {/* Blast Radius Charts */}
          {outdated?.data && outdated.data.length > 0 && (
            <BlastRadiusCharts outdatedApps={outdated.data} />
          )}

          {outdatedLoading ? (
            <DataTableSkeleton rows={6} columns={6} />
          ) : !outdated?.data.length ? (
            <EmptyState
              icon={<ShieldAlert className="w-8 h-8" />}
              title="No updates needed"
              description={
                data?.total
                  ? "All discovered apps are up to date with your Intune catalog."
                  : "Run a radar scan first, then sync apps from Intune to compare versions."
              }
            />
          ) : (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-surface-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium text-text">
                  {outdated.total} app{outdated.total !== 1 ? "s" : ""} need updating across your managed devices
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-3 text-text-muted font-medium">Application</th>
                    <th className="text-left px-5 py-3 text-text-muted font-medium">Installed</th>
                    <th className="text-left px-5 py-3 text-text-muted font-medium">Available</th>
                    <th className="text-left px-5 py-3 text-text-muted font-medium">Blast Radius</th>
                    <th className="text-left px-5 py-3 text-text-muted font-medium">Severity</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {outdated.data.map((app) => (
                    <tr key={app.discoveryId} className="border-b border-border/50 last:border-0 hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-text">{app.appName}</p>
                        <p className="text-xs text-text-muted">{app.publisher}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                          v{app.installedVersion}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                          v{app.latestVersion}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Target className="w-3.5 h-3.5 text-primary" />
                          <div>
                            <span className="font-semibold text-text">{app.deviceCount.toLocaleString()}</span>
                            <span className="text-text-muted text-xs ml-1">devices</span>
                            <p className="text-[10px] text-text-muted">
                              ~{Math.round(app.deviceCount * 1.3)} users exposed
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <SeverityBadge severity={app.severity} />
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => navigate(`/instant-apps/${encodeURIComponent(app.matchedWingetId)}`)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Update Now
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Blast Radius Map tab ── */}
      {tab === "blast" && (
        <div className="animate-fade-in">
          {blastData?.children?.length ? (
            <BlastRadiusMap data={blastData} width={1100} height={600} />
          ) : (
            <div className="text-center py-16 text-text-muted">
              <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Run a Radar scan first to populate the blast radius map.</p>
            </div>
          )}
        </div>
      )}

      {/* ── All Discovered tab ── */}
      {tab === "all" && (
        <>
          {isLoading ? (
            <DataTableSkeleton rows={12} columns={5} />
          ) : !data?.data.length ? (
            <EmptyState
              icon={<Radar className="w-8 h-8" />}
              title="No discovered apps"
              description="Run a radar scan to discover apps installed across your managed devices."
              action={
                <button onClick={handleScan} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg">
                  Start Scan
                </button>
              }
            />
          ) : (
            <>
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2">
                      {[
                        { key: "appName", label: "Application" },
                        { key: "installedVersion", label: "Version" },
                        { key: "deviceCount", label: "Devices" },
                        { key: "lastScanned", label: "Last Scanned" },
                      ].map((col) => (
                        <th key={col.key} className="text-left px-5 py-3">
                          <button
                            onClick={() => toggleSort(col.key)}
                            className="flex items-center gap-1.5 text-text-muted font-medium hover:text-text"
                          >
                            {col.label}
                            <ArrowUpDown className="w-3.5 h-3.5" />
                          </button>
                        </th>
                      ))}
                      <th className="text-left px-5 py-3 text-text-muted font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((disc) => (
                      <tr key={disc.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-text">{disc.appName}</p>
                          <p className="text-xs text-text-muted">{disc.publisher}</p>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-text-muted">{disc.installedVersion}</td>
                        <td className="px-5 py-3">
                          <span className="font-semibold text-text">{disc.deviceCount.toLocaleString()}</span>
                          <span className="text-text-muted text-xs ml-1">devices</span>
                        </td>
                        <td className="px-5 py-3 text-text-muted text-xs">
                          {formatDistanceToNow(new Date(disc.lastScanned), { addSuffix: true })}
                        </td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => handleManage(disc.id, disc.appName)}
                            disabled={manageApp.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-2 hover:bg-border text-text-muted hover:text-text rounded-lg transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40">Previous</button>
                  <span className="text-sm text-text-muted">Page {page} of {data.totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40">Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
