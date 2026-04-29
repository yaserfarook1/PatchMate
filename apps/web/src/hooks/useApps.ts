import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AppDto, PaginatedResponse } from "@autopack/shared";

export function useApps(params: { search?: string; category?: string; page?: number; pageSize?: number } = {}) {
  return useQuery<PaginatedResponse<AppDto>>({
    queryKey: ["apps", params],
    queryFn: () => api.get("/apps", { params }).then((r) => r.data),
  });
}

export function useApp(id: string | undefined) {
  return useQuery({
    queryKey: ["app", id],
    queryFn: () => api.get(`/apps/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useAppCategories() {
  return useQuery<{ name: string; count: number }[]>({
    queryKey: ["app-categories"],
    queryFn: () => api.get("/apps/categories").then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useBuildPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { appId: string; tenantId: string; installCmd?: string; uninstallCmd?: string; detectionMethod?: string }) =>
      api.post(`/apps/${vars.appId}/build-package`, vars).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
    },
  });
}
