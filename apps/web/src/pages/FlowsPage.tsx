import React from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, Plus, Trash2, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useFlows, useDeleteFlow } from "../hooks/useFlows";
import { useTenant } from "../contexts/TenantContext";
import { usePermission } from "../hooks/usePermission";
import { StatusBadge } from "../components/ui/StatusBadge";
import { DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { EmptyState } from "../components/ui/EmptyState";

export function FlowsPage() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const canManage = usePermission("FLOW_MANAGE");
  const { data, isLoading } = useFlows({ tenantId: activeTenantId ?? undefined });
  const deleteFlow = useDeleteFlow();

  async function handleDelete(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete flow "${name}"?`)) return;
    try {
      await deleteFlow.mutateAsync(id);
      toast.success(`Flow "${name}" deleted`);
    } catch {
      toast.error("Failed to delete flow");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Patch Flows</h1>
          <p className="text-text-muted text-sm mt-1">{data?.total ?? 0} deployment flows</p>
        </div>
        {canManage && (
          <button
            onClick={() => navigate("/flows/new")}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Flow
          </button>
        )}
      </div>

      {isLoading ? (
        <DataTableSkeleton rows={5} columns={5} />
      ) : !data?.data.length ? (
        <EmptyState
          icon={<GitBranch className="w-8 h-8" />}
          title="No patch flows"
          description="Create a deployment flow to automate app updates through waves."
          action={
            canManage ? (
              <button onClick={() => navigate("/flows/new")} className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg">
                New Flow
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4">
          {data.data.map((flow) => (
            <div
              key={flow.id}
              onClick={() => navigate(`/flows/${flow.id}`)}
              className="bg-surface border border-border rounded-xl p-5 cursor-pointer card-hover"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
                    <GitBranch className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-text">{flow.name}</h2>
                    <p className="text-sm text-text-muted">{flow.app?.name}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {formatDistanceToNow(new Date(flow.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {flow.autoUpdate && (
                    <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">
                      <Zap className="w-3 h-3" />
                      Auto-update
                    </span>
                  )}
                  {canManage && (
                    <button
                      onClick={(e) => handleDelete(flow.id, flow.name, e)}
                      className="p-1.5 text-text-muted hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Wave pipeline visual */}
              {flow.waves && flow.waves.length > 0 && (
                <div className="flex items-center gap-2 mt-4">
                  {flow.waves.map((wave, i) => (
                    <React.Fragment key={wave.id}>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={wave.status} />
                        <span className="text-xs text-text-muted">{wave.name}</span>
                      </div>
                      {i < flow.waves!.length - 1 && (
                        <div className="flex-1 h-px bg-border max-w-8" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
