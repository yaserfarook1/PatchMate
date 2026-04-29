import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Download, Rocket, Package2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useInstantApp, useInstantDeploy } from "../hooks/useInstantApps";
import { useTenant } from "../contexts/TenantContext";
import { useTenants } from "../hooks/useTenants";
import { useGroups } from "../hooks/useGroups";
import { getSocket } from "../lib/socket";
import { cn } from "../lib/utils";

export function InstantAppDetailPage() {
  const { wingetId } = useParams<{ wingetId: string }>();
  const navigate = useNavigate();
  const decodedId = wingetId ? decodeURIComponent(wingetId) : "";
  const { data: app, isLoading } = useInstantApp(decodedId || undefined);
  const { activeTenantId, setActiveTenantId } = useTenant();
  const { data: tenants } = useTenants();
  const { data: groups } = useGroups(activeTenantId);
  const deploy = useInstantDeploy();

  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [showDeploy, setShowDeploy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState({ step: "", percent: 0 });

  useEffect(() => {
    if (app?.latestVersion && !selectedVersion) setSelectedVersion(app.latestVersion);
  }, [app?.latestVersion]);

  useEffect(() => {
    const socket = getSocket();
    const onProgress = (p: any) => setDeployProgress({ step: p.step, percent: p.percent });
    const onComplete = () => { setDeploying(false); toast.success("Deployed to Intune!"); };
    const onFailed = (p: any) => { setDeploying(false); toast.error(p.error); };
    socket.on("instant-deploy:progress", onProgress);
    socket.on("instant-deploy:complete", onComplete);
    socket.on("instant-deploy:failed", onFailed);
    return () => { socket.off("instant-deploy:progress", onProgress); socket.off("instant-deploy:complete", onComplete); socket.off("instant-deploy:failed", onFailed); };
  }, []);

  async function handleDeploy() {
    if (!activeTenantId || !selectedVersion) {
      toast.error("Select a tenant and version first");
      return;
    }
    setDeploying(true);
    setDeployProgress({ step: "Starting...", percent: 0 });
    try {
      await deploy.mutateAsync({
        wingetId: decodedId,
        version: selectedVersion,
        tenantId: activeTenantId,
        groupId: selectedGroup || undefined,
      });
      setShowDeploy(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Deploy failed");
      setDeploying(false);
    }
  }

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-surface rounded w-1/3" />
      <div className="h-64 bg-surface rounded-xl" />
    </div>
  );

  if (!app) return <div className="text-text-muted">App not found</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={() => navigate("/instant-apps")} className="flex items-center gap-2 text-text-muted hover:text-text text-sm">
        <ArrowLeft className="w-4 h-4" /> Back to Instant Apps
      </button>

      {/* Header */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center text-primary font-bold text-xl shrink-0">
            {app.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-text">{app.name}</h1>
            <p className="text-text-muted">{app.publisher}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs font-mono bg-surface-2 px-2 py-1 rounded text-text-muted">
                {decodedId}
              </span>
              <span className="text-xs text-text-muted">
                {app.versions?.length ?? 1} version{(app.versions?.length ?? 1) !== 1 ? "s" : ""} available
              </span>
            </div>
            {app.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {app.tags.map((t) => (
                  <span key={t} className="text-xs bg-surface-2 text-text-muted px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowDeploy(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Rocket className="w-4 h-4" />
            Build & Deploy
          </button>
        </div>
      </div>

      {/* Version Table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Available Versions</h2>
          <span className="text-xs text-text-muted">{app.versions?.length ?? 1} versions</span>
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border">
                <th className="text-left px-5 py-2.5 text-text-muted font-medium">Version</th>
                <th className="text-left px-5 py-2.5 text-text-muted font-medium">Package ID</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(app.versions ?? [{ version: app.latestVersion }]).map((v, i) => (
                <tr
                  key={v.version}
                  className={cn(
                    "border-b border-border/50 last:border-0 hover:bg-surface-2 transition-colors",
                    v.version === app.latestVersion && "bg-green-500/5"
                  )}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-text">{v.version}</span>
                      {v.version === app.latestVersion && (
                        <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Latest</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-text-muted font-mono text-xs">{decodedId}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => { setSelectedVersion(v.version); setShowDeploy(true); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors ml-auto"
                    >
                      <Zap className="w-3 h-3" /> Build & Deploy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deploy Modal */}
      {showDeploy && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            {deploying ? (
              <div className="text-center py-8 space-y-4">
                <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
                <p className="text-text font-medium">{deployProgress.step}</p>
                <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${deployProgress.percent}%` }} />
                </div>
                <p className="text-xs text-text-muted">{deployProgress.percent}%</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-text mb-1">Build & Deploy</h2>
                <p className="text-text-muted text-sm mb-5">
                  <strong>{app.name}</strong> v{selectedVersion}
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-1.5">Version</label>
                    <select
                      value={selectedVersion}
                      onChange={(e) => setSelectedVersion(e.target.value)}
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {(app.versions ?? [{ version: app.latestVersion }]).map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.version} {v.version === app.latestVersion ? "(Latest)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-1.5">Tenant</label>
                    <select
                      value={activeTenantId ?? ""}
                      onChange={(e) => setActiveTenantId(e.target.value)}
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      {tenants?.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-1.5">
                      Assign to Entra Group (optional)
                    </label>
                    <select
                      value={selectedGroup}
                      onChange={(e) => setSelectedGroup(e.target.value)}
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">Build only — assign later via Patch Flow</option>
                      {groups?.map((g) => <option key={g.id} value={g.id}>{g.displayName}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowDeploy(false)}
                    className="flex-1 px-4 py-2.5 border border-border text-text-muted hover:text-text rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeploy}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Rocket className="w-4 h-4" />
                    {selectedGroup ? "Build & Deploy" : "Build Package"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
