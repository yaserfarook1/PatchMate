import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PackageDto, PaginatedResponse } from "@autopack/shared";

export function usePackages(params: { tenantId?: string; page?: number; pageSize?: number; status?: string } = {}) {
  return useQuery<PaginatedResponse<PackageDto>>({
    queryKey: ["packages", params],
    queryFn: () => api.get("/packages", { params }).then((r) => r.data),
  });
}

export function usePackage(id: string | undefined) {
  return useQuery({
    queryKey: ["package", id],
    queryFn: () => api.get(`/packages/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: (data: any) => {
      if (data?.validationStatus === "running" || data?.validationStatus === "pending") {
        return 3000;
      }
      return false;
    },
  });
}

export function useDeletePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/packages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages"] }),
  });
}
