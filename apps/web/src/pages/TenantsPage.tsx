import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Plus, Trash2, RefreshCw, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useTenants, useDisconnectTenant, useSyncTenant } from "../hooks/useTenants";
import { usePermission } from "../hooks/usePermission";
import { DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { useTenant } from "../contexts/TenantContext";
import { api } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";

export function TenantsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = usePermission("TENANT_MANAGE");
  const { data: tenants, isLoading } = useTenants();
  const disconnect = useDisconnectTenant();
  const sync = useSyncTenant();
  const { setActiveTenantId } = useTenant();
  const qc = useQueryClient();

  useEffect(() => {
    const connectedId = searchParams.get("connected");
    if (connectedId) {
      toast.success("Tenant connected successfully!");
      setActiveTenantId(connectedId);
      setSearchParams({}, { replace: true });
    }
    const error = searchParams.get("error");
    if (error) {
      toast.error(`Connection failed: ${decodeURIComponent(error)}`);
      setSearchParams({}, { replace: true });
    }
  }, []);

  async function handleDisconnect(id: string, name: string) {
    if (!confirm(`Disconnect tenant "${name}"? All associated data will be removed.`)) return;
    try {
      await disconnect.mutateAsync(id);
      toast.success(`Tenant "${name}" disconnected`);
    } catch {
      toast.error("Failed to disconnect tenant");
    }
  }

  async function handleSync(id: string) {
    try {
      await sync.mutateAsync(id);
      toast.success("Tenant synced");
    } catch {
      toast.error("Sync failed — token may have expired. Reconnect the tenant.");
    }
  }

  async function handleSyncApps(tenantId: string) {
    const toastId = toast.loading("Syncing apps from Intune...");
    try {
      const { data } = await api.post(`/tenants/${tenantId}/sync-apps`);
      toast.success(`Synced ${data.synced} apps (${data.created} new, ${data.updated} updated)`, { id: toastId });
      qc.invalidateQueries({ queryKey: ["apps"] });
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "App sync failed", { id: toastId });
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Tenants</h1>
          <p className="text-text-muted text-sm mt-1">{tenants?.length ?? 0} connected tenants</p>
        </div>
        {canManage && (
          <button
            onClick={() => navigate("/tenants/connect")}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Connect Tenant
          </button>
        )}
      </div>

      {isLoading ? (
        <DataTableSkeleton rows={2} columns={4} />
      ) : !tenants?.length ? (
        <EmptyState
          icon={<Building2 className="w-8 h-8" />}
          title="No tenants connected"
          description="Connect your Microsoft Intune tenant to start managing and packaging apps."
          action={
            canManage ? (
              <button
                onClick={() => navigate("/tenants/connect")}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg"
              >
                Connect Tenant
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => (
            <div key={tenant.id} className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-text">{tenant.displayName}</h2>
                    <p className="text-xs font-mono text-text-muted">
                      Client: {tenant.intuneClientId}
                    </p>
                    {(tenant as any).azureTenantId && (
                      <p className="text-xs font-mono text-text-muted/60">
                        Tenant: {(tenant as any).azureTenantId}
                      </p>
                    )}
                    <p className="text-xs text-text-muted mt-1">
                      {tenant.lastSyncAt
                        ? `Last synced ${formatDistanceToNow(new Date(tenant.lastSyncAt), { addSuffix: true })}`
                        : "Never synced"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSync(tenant.id)}
                    disabled={sync.isPending}
                    className="p-2 text-text-muted hover:text-text hover:bg-surface-2 rounded-lg transition-colors"
                    title="Refresh device count"
                  >
                    <RefreshCw className={`w-4 h-4 ${sync.isPending ? "animate-spin" : ""}`} />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => handleSyncApps(tenant.id)}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs bg-surface-2 hover:bg-border text-text-muted hover:text-text rounded-lg transition-colors"
                        title="Pull managed apps from Intune"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Sync Apps
                      </button>
                      <button
                        onClick={() => handleDisconnect(tenant.id, tenant.displayName)}
                        className="p-2 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Disconnect"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-border">
                {[
                  { label: "Devices", value: tenant.deviceCount.toLocaleString() },
                  { label: "Packages", value: (tenant as any)._count?.packages ?? 0 },
                  { label: "Patch Flows", value: (tenant as any)._count?.patchFlows ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-2xl font-bold text-text">{value}</p>
                    <p className="text-xs text-text-muted">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
