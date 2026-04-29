import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PatchFlowDto, PaginatedResponse } from "@autopack/shared";

export function useFlows(params: { tenantId?: string; page?: number } = {}) {
  return useQuery<PaginatedResponse<PatchFlowDto>>({
    queryKey: ["flows", params],
    queryFn: () => api.get("/flows", { params }).then((r) => r.data),
  });
}

export function useFlow(id: string | undefined) {
  return useQuery<PatchFlowDto>({
    queryKey: ["flow", id],
    queryFn: () => api.get(`/flows/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useCreateFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { appId: string; tenantId: string; name: string; autoUpdate?: boolean; waves?: any[] }) =>
      api.post("/flows", vars).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

export function useUpdateFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name?: string; autoUpdate?: boolean; waves?: any[] }) => {
      const { id, ...data } = vars;
      return api.patch(`/flows/${id}`, data).then((r) => r.data);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["flow", vars.id] });
    },
  });
}

export function useDeleteFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/flows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

export function useTriggerWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { flowId: string; waveId: string }) =>
      api.post(`/flows/${vars.flowId}/trigger-wave`, { waveId: vars.waveId }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["flow", vars.flowId] });
    },
  });
}
