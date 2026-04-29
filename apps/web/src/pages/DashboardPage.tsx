import React from "react";
import { useNavigate } from "react-router-dom";
import { Package, Building2, Activity, Rocket, Plus, RefreshCw, Zap, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useDashboardStats, useAuditLogs } from "../hooks/useDashboard";
import { useTenant } from "../contexts/TenantContext";
import { CardSkeleton, DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { StatusBadge } from "../components/ui/StatusBadge";
import { cn } from "../lib/utils";

const ACTION_CONFIG: Record<string, { color: string; label: string }> = {
  PACKAGE_CREATED: { color: "text-blue-400", label: "Package created" },
  PACKAGE_VALIDATED: { color: "text-green-400", label: "Package validated" },
  PACKAGE_BUILD_QUEUED: { color: "text-yellow-400", label: "Build queued" },
  DEPLOYMENT_TRIGGERED: { color: "text-purple-400", label: "Deployment triggered" },
  TENANT_CONNECTED: { color: "text-green-400", label: "Tenant connected" },
  TENANT_DISCONNECTED: { color: "text-red-400", label: "Tenant disconnected" },
  FLOW_CREATED: { color: "text-blue-400", label: "Flow created" },
  USER_LOGIN: { color: "text-text-muted", label: "User signed in" },
  APP_BROUGHT_UNDER_MANAGEMENT: { color: "text-purple-400", label: "App managed" },
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { data: stats, isLoading: statsLoading } = useDashboardStats(activeTenantId);
  const { data: auditData, isLoading: auditLoading } = useAuditLogs(10);

  const statCards = [
    {
      label: "Total Packages",
      value: stats?.totalPackages ?? 0,
      icon: Package,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Connected Tenants",
      value: stats?.activeTenantsCount ?? 0,
      icon: Building2,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Active Jobs",
      value: stats?.runningJobs ?? 0,
      icon: Activity,
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      pulse: (stats?.runningJobs ?? 0) > 0,
    },
    {
      label: "Deployments (7d)",
      value: stats?.deploymentsThisWeek ?? 0,
      icon: Rocket,
      color: "text-green-400",
      bg: "bg-green-500/10",
    },
    {
      label: "Updates Needed",
      value: stats?.appsNeedingUpdate ?? 0,
      icon: AlertTriangle,
      color: (stats?.appsNeedingUpdate ?? 0) > 0 ? "text-red-400" : "text-text-muted",
      bg: (stats?.appsNeedingUpdate ?? 0) > 0 ? "bg-red-500/10" : "bg-surface-2",
      href: "/radar",
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Dashboard</h1>
          <p className="text-text-muted text-sm mt-1">AutoPack overview & recent activity</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate("/catalog")}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add App
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
          : statCards.map((card) => (
              <div
                key={card.label}
                onClick={() => (card as any).href && navigate((card as any).href)}
                className={cn("bg-surface border border-border rounded-xl p-6 card-hover", (card as any).href ? "cursor-pointer" : "cursor-default")}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-text-muted">{card.label}</span>
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", card.bg)}>
                    <card.icon className={cn("w-5 h-5", card.color, card.pulse && "animate-pulse-slow")} />
                  </div>
                </div>
                <div className="text-3xl font-bold text-text">{card.value.toLocaleString()}</div>
              </div>
            ))}
      </div>

      {/* Package status breakdown */}
      {stats?.packagesByStatus && stats.packagesByStatus.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
            Package Status Breakdown
          </h2>
          <div className="flex flex-wrap gap-3">
            {stats.packagesByStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-2">
                <StatusBadge status={s.status} />
                <span className="text-sm font-semibold text-text">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Browse Catalog", icon: Package, href: "/catalog", color: "hover:border-blue-500/50" },
            { label: "New Patch Flow", icon: Zap, href: "/flows/new", color: "hover:border-purple-500/50" },
            { label: "Radar Scan", icon: Activity, href: "/radar", color: "hover:border-yellow-500/50" },
            { label: "Connect Tenant", icon: Building2, href: "/tenants/connect", color: "hover:border-green-500/50" },
          ].map((a) => (
            <button
              key={a.href}
              onClick={() => navigate(a.href)}
              className={cn(
                "flex flex-col items-center gap-2 p-4 bg-surface-2 border border-border rounded-xl text-sm text-text-muted hover:text-text transition-all",
                a.color
              )}
            >
              <a.icon className="w-6 h-6" />
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity feed */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">
            Recent Activity
          </h2>
          <RefreshCw className="w-4 h-4 text-text-muted" />
        </div>

        {auditLoading ? (
          <DataTableSkeleton rows={6} columns={3} />
        ) : !auditData?.data.length ? (
          <p className="text-text-muted text-sm text-center py-8">No recent activity</p>
        ) : (
          <div className="space-y-3">
            {auditData.data.map((log) => {
              const config = ACTION_CONFIG[log.action] ?? { color: "text-text-muted", label: log.action };
              return (
                <div key={log.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={cn("text-sm font-medium", config.color)}>{config.label}</span>
                    {log.details && (
                      <span className="text-text-muted text-sm ml-2">
                        — {(log.details as any).appName ?? (log.details as any).displayName ?? (log.details as any).name ?? log.resourceId}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-text-muted">
                      {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-text-muted/60">{log.user?.name}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
