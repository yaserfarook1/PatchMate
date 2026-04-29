import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DashboardStats, AuditLogDto, PaginatedResponse } from "@autopack/shared";

export function useDashboardStats(tenantId?: string | null) {
  return useQuery<DashboardStats>({
    queryKey: ["dashboard-stats", tenantId],
    queryFn: () =>
      api.get("/dashboard/stats", { params: tenantId ? { tenantId } : {} }).then((r) => r.data),
    refetchInterval: 15_000,
  });
}

export function useAuditLogs(limit = 15) {
  return useQuery<PaginatedResponse<AuditLogDto>>({
    queryKey: ["audit-logs", limit],
    queryFn: () => api.get("/audit-logs", { params: { limit } }).then((r) => r.data),
    refetchInterval: 30_000,
  });
}
