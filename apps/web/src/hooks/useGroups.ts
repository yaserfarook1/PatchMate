import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface EntraGroup {
  id: string;
  displayName: string;
  description: string | null;
  groupTypes: string[];
}

export function useGroups(tenantId: string | null) {
  return useQuery<EntraGroup[]>({
    queryKey: ["groups", tenantId],
    queryFn: () => api.get(`/tenants/${tenantId}/groups`).then((r) => r.data),
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
  });
}
