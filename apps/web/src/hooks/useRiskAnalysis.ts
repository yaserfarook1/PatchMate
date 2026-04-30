import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTenant } from "../contexts/TenantContext";

export function useRiskReport() {
  const { activeTenantId } = useTenant();

  return useQuery({
    queryKey: ["risk-analysis", activeTenantId],
    queryFn: async () => {
      const { data } = await api.get(`/risk/analysis/${activeTenantId}`);
      return data;
    },
    enabled: !!activeTenantId,
    refetchInterval: (query) => {
      if (query.state.data?.cached === false && query.state.data?.entries?.length === 0) return 5000;
      return false;
    },
  });
}

export function useTriggerAnalysis() {
  const { activeTenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.get(`/risk/analysis/${activeTenantId}/sync`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["risk-analysis", activeTenantId] });
    },
  });
}

export function useTenantProfile() {
  const { activeTenantId } = useTenant();

  return useQuery({
    queryKey: ["tenant-profile", activeTenantId],
    queryFn: async () => {
      const { data } = await api.get(`/risk/tenant-profile/${activeTenantId}`);
      return data;
    },
    enabled: !!activeTenantId,
  });
}

export function useLearnTenant() {
  const { activeTenantId } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/risk/tenant-profile/${activeTenantId}/learn`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-profile", activeTenantId] });
    },
  });
}
