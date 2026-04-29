import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Package, Play, Download } from "lucide-react";
import { toast } from "sonner";
import { useApp, useBuildPackage } from "../hooks/useApps";
import { useTenant } from "../contexts/TenantContext";
import { usePermission } from "../hooks/usePermission";
import { StatusBadge } from "../components/ui/StatusBadge";
import { formatDistanceToNow } from "date-fns";

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const canBuild = usePermission("PACKAGE_BUILD");
  const { data: app, isLoading } = useApp(id);
  const buildPackage = useBuildPackage();
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [installCmd, setInstallCmd] = useState("");
  const [uninstallCmd, setUninstallCmd] = useState("");

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-surface rounded w-1/3" />
        <div className="h-48 bg-surface rounded-xl" />
      </div>
    );
  }

  if (!app) return <div className="text-text-muted">App not found</div>;

  async function handleBuild() {
    if (!activeTenantId) {
      toast.error("Please select a tenant first");
      return;
    }
    try {
      const result = await buildPackage.mutateAsync({
        appId: app.id,
        tenantId: activeTenantId,
        installCmd: installCmd || undefined,
        uninstallCmd: uninstallCmd || undefined,
      });
      toast.success("Package build queued!");
      setShowBuildModal(false);
      navigate(`/packages/${result.packageId}`);
    } catch {
      toast.error("Failed to queue package build");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={() => navigate("/catalog")}
        className="flex items-center gap-2 text-text-muted hover:text-text text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Catalog
      </button>

      {/* App header */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-primary/20 flex items-center justify-center text-primary font-bold text-xl shrink-0">
            {app.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-text">{app.name}</h1>
                <p className="text-text-muted">{app.publisher}</p>
              </div>
              <StatusBadge status={app.status} />
            </div>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-xs font-mono bg-surface-2 px-2 py-1 rounded text-text-muted">
                v{app.latestVersion}
              </span>
              <span className="text-xs bg-surface-2 px-2 py-1 rounded text-text-muted">
                {app.category}
              </span>
              <span className="text-xs text-text-muted font-mono">{app.wingetId}</span>
            </div>
            {app.description && (
              <p className="text-text-muted text-sm mt-3">{app.description}</p>
            )}
          </div>
        </div>

        {canBuild && (
          <div className="flex gap-3 mt-6 pt-6 border-t border-border">
            <button
              onClick={() => setShowBuildModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Play className="w-4 h-4" />
              Build Package
            </button>
          </div>
        )}
      </div>

      {/* Recent packages */}
      {app.packages && app.packages.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
            Package History
          </h2>
          <div className="space-y-3">
            {app.packages.map((pkg: any) => (
              <div
                key={pkg.id}
                onClick={() => navigate(`/packages/${pkg.id}`)}
                className="flex items-center justify-between py-3 px-4 rounded-lg bg-surface-2 hover:bg-border cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Package className="w-4 h-4 text-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-text">v{pkg.version}</p>
                    <p className="text-xs text-text-muted">{pkg.tenant?.displayName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={pkg.validationStatus} />
                  <span className="text-xs text-text-muted">
                    {formatDistanceToNow(new Date(pkg.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Build modal */}
      {showBuildModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h2 className="text-lg font-semibold text-text mb-1">Build Package</h2>
            <p className="text-text-muted text-sm mb-5">
              Building <strong>{app.name}</strong> v{app.latestVersion}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">
                  Install Command (optional)
                </label>
                <input
                  value={installCmd}
                  onChange={(e) => setInstallCmd(e.target.value)}
                  placeholder={`${app.name.replace(/\s/g, "")}_setup.exe /S /quiet`}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">
                  Uninstall Command (optional)
                </label>
                <input
                  value={uninstallCmd}
                  onChange={(e) => setUninstallCmd(e.target.value)}
                  placeholder="Uninstall.exe /S"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowBuildModal(false)}
                className="flex-1 px-4 py-2.5 border border-border text-text-muted hover:text-text rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBuild}
                disabled={buildPackage.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              >
                {buildPackage.isPending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Start Build
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
