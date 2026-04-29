import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface InstantAppDto {
  id: string;
  wingetId: string;
  name: string;
  publisher: string;
  latestVersion: string;
  tags: string[];
  lastUpdate: string | null;
}

export interface InstantAppDetail extends InstantAppDto {
  versions: { version: string }[];
}

export function useInstantApps(params: { search?: string; page?: number; pageSize?: number; tag?: string } = {}) {
  return useQuery<{ data: InstantAppDto[]; total: number; page: number; pageSize: number; totalPages: number }>({
    queryKey: ["instant-apps", params],
    queryFn: () => api.get("/instant-apps", { params }).then((r) => r.data),
  });
}

export function useInstantApp(wingetId: string | undefined) {
  return useQuery<InstantAppDetail>({
    queryKey: ["instant-app", wingetId],
    queryFn: () => api.get(`/instant-apps/${encodeURIComponent(wingetId!)}`).then((r) => r.data),
    enabled: !!wingetId,
  });
}

export function useInstantAppTags() {
  return useQuery<{ tag: string; count: number }[]>({
    queryKey: ["instant-app-tags"],
    queryFn: () => api.get("/instant-apps/tags").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useInstantDeploy() {
  return useMutation({
    mutationFn: (vars: { wingetId: string; version: string; tenantId: string; groupId?: string }) =>
      api.post("/instant-apps/deploy", vars).then((r) => r.data),
  });
}
