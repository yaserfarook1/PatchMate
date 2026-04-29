import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DeviceDiscoveryDto, PaginatedResponse } from "@autopack/shared";

export interface OutdatedApp {
  discoveryId: string;
  appName: string;
  publisher: string;
  installedVersion: string;
  latestVersion: string;
  deviceCount: number;
  matchedAppId?: string;
  matchedWingetId: string;
  severity: "critical" | "high" | "medium";
}

export function useRadarResults(
  tenantId: string | null,
  params: { page?: number; pageSize?: number; sort?: string; order?: string } = {}
) {
  return useQuery<PaginatedResponse<DeviceDiscoveryDto>>({
    queryKey: ["radar", tenantId, params],
    queryFn: () => api.get(`/radar/results/${tenantId}`, { params }).then((r) => r.data),
    enabled: !!tenantId,
  });
}

export function useStartRadarScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => api.post(`/radar/scan/${tenantId}`).then((r) => r.data),
    onSuccess: (_data, tenantId) => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["radar", tenantId] }), 8000);
    },
  });
}

export function useOutdatedApps(tenantId: string | null) {
  return useQuery<{ data: OutdatedApp[]; total: number }>({
    queryKey: ["radar-outdated", tenantId],
    queryFn: () => api.get(`/radar/outdated/${tenantId}`).then((r) => r.data),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

export function useBlastRadius(tenantId: string | null) {
  return useQuery<any>({
    queryKey: ["blast-radius", tenantId],
    queryFn: () => api.get(`/radar/blast-radius/${tenantId}`).then((r) => r.data),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

export function useManageDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (discoveryId: string) => api.post(`/radar/${discoveryId}/manage`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
