import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Package2, Filter, Loader2 } from "lucide-react";
import { useApps, useAppCategories } from "../hooks/useApps";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { AppDto } from "@autopack/shared";
import { cn } from "../lib/utils";

function AppCard({ app, onClick }: { app: AppDto & { _count?: { packages: number } }; onClick: () => void }) {
  const initials = app.name.slice(0, 2).toUpperCase();
  return (
    <div
      onClick={onClick}
      className="bg-surface border border-border rounded-xl p-5 cursor-pointer card-hover group"
    >
      <div className="flex items-start gap-3 mb-3">
        {app.iconUrl ? (
          <img src={app.iconUrl} alt={app.name} className="w-10 h-10 rounded-lg object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text text-sm truncate group-hover:text-primary transition-colors">
            {app.name}
          </h3>
          <p className="text-text-muted text-xs truncate">{app.publisher}</p>
        </div>
        <span title={
          app.status === "validated" ? "AutoPack package built & VM-tested" :
          app.status === "pending"   ? "In catalog — no package built yet" :
          "Last package build failed"
        }>
          <StatusBadge status={app.status} />
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-text-muted bg-surface-2 px-2 py-1 rounded">
          v{app.latestVersion}
        </span>
        <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded-full">
          {app.category}
        </span>
      </div>
    </div>
  );
}

export function CatalogPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const { data: categories } = useAppCategories();
  const { data, isLoading } = useApps({ search: debouncedSearch, category, page, pageSize: 24 });

  const searchTimeout = React.useRef<ReturnType<typeof setTimeout>>();
  function handleSearch(v: string) {
    setSearch(v);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 400);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">App Catalog</h1>
          <p className="text-text-muted text-sm mt-1">
            {data?.total ?? 0} apps available from the Winget catalog
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search apps, publishers..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-muted shrink-0" />
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-surface-2" />
                <div className="flex-1">
                  <div className="h-4 bg-surface-2 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-surface-2 rounded w-1/2" />
                </div>
              </div>
              <div className="flex justify-between">
                <div className="h-6 bg-surface-2 rounded w-16" />
                <div className="h-6 bg-surface-2 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Package2 className="w-8 h-8" />}
          title="No apps found"
          description={search ? `No results for "${search}". Try a different search term.` : "No apps in catalog yet."}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.data.map((app) => (
              <AppCard key={app.id} app={app as any} onClick={() => navigate(`/catalog/${app.id}`)} />
            ))}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-text-muted">
                Page {page} of {data.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
