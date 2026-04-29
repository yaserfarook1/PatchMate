import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, Plus, Download, Trash2, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { usePackages, useDeletePackage } from "../hooks/usePackages";
import { useTenant } from "../contexts/TenantContext";
import { StatusBadge } from "../components/ui/StatusBadge";
import { DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { usePermission } from "../hooks/usePermission";

const STATUS_FILTERS = ["", "passed", "failed", "running", "pending"] as const;

export function PackagesPage() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const canBuild = usePermission("PACKAGE_BUILD");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePackages({ tenantId: activeTenantId ?? undefined, status: statusFilter, page });
  const deletePackage = useDeletePackage();

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this package?")) return;
    try {
      await deletePackage.mutateAsync(id);
      toast.success("Package deleted");
    } catch {
      toast.error("Failed to delete package");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Packages</h1>
          <p className="text-text-muted text-sm mt-1">{data?.total ?? 0} packages total</p>
        </div>
        {canBuild && (
          <button
            onClick={() => navigate("/packages/upload")}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Upload App
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-text-muted" />
        <div className="flex gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                statusFilter === s
                  ? "bg-primary border-primary text-white"
                  : "border-border text-text-muted hover:text-text hover:border-primary/50"
              }`}
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <DataTableSkeleton rows={10} columns={6} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Archive className="w-8 h-8" />}
          title="No packages yet"
          description="Build your first package from the App Catalog."
          action={
            canBuild ? (
              <button
                onClick={() => navigate("/catalog")}
                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg"
              >
                Browse Catalog
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="text-left px-5 py-3 text-text-muted font-medium">App</th>
                  <th className="text-left px-5 py-3 text-text-muted font-medium">Version</th>
                  <th className="text-left px-5 py-3 text-text-muted font-medium">Tenant</th>
                  <th className="text-left px-5 py-3 text-text-muted font-medium">Status</th>
                  <th className="text-left px-5 py-3 text-text-muted font-medium">Created</th>
                  <th className="text-left px-5 py-3 text-text-muted font-medium">Size</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((pkg) => (
                  <tr
                    key={pkg.id}
                    onClick={() => navigate(`/packages/${pkg.id}`)}
                    className="border-b border-border/50 last:border-0 hover:bg-surface-2 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <p className="font-medium text-text">{(pkg as any).app?.name ?? "Unknown App"}</p>
                      <p className="text-xs text-text-muted">{(pkg as any).app?.publisher}</p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-text-muted">{pkg.version}</td>
                    <td className="px-5 py-3 text-text-muted">{(pkg as any).tenant?.displayName ?? "-"}</td>
                    <td className="px-5 py-3"><StatusBadge status={pkg.validationStatus} /></td>
                    <td className="px-5 py-3 text-text-muted text-xs">
                      {formatDistanceToNow(new Date(pkg.createdAt), { addSuffix: true })}
                    </td>
                    <td className="px-5 py-3 text-text-muted text-xs">
                      {pkg.fileSize ? `${Math.round(pkg.fileSize / 1024)} KB` : "-"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {pkg.intuneWinPath && (
                          <a
                            href={`/api/packages/${pkg.id}/download`}
                            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                        {canBuild && (
                          <button
                            onClick={(e) => handleDelete(pkg.id, e)}
                            className="p-1.5 text-text-muted hover:text-red-400 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-text-muted">Page {page} of {data.totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
