import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { TenantDto } from "@autopack/shared";

export function useTenants() {
  return useQuery<TenantDto[]>({
    queryKey: ["tenants"],
    queryFn: () => api.get("/tenants").then((r) => r.data),
  });
}

export function useTenant(id: string | undefined) {
  return useQuery({
    queryKey: ["tenant", id],
    queryFn: () => api.get(`/tenants/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useConnectTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { displayName: string; intuneClientId: string; orgId?: string }) =>
      api.post("/tenants/connect", vars).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
  });
}

export function useDisconnectTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tenants/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
  });
}

export function useSyncTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/tenants/${id}/sync`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
  });
}
