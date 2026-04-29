import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Search, Package2, Clock, Tag } from "lucide-react";
import { useInstantApps, useInstantAppTags } from "../hooks/useInstantApps";
import { DataTableSkeleton } from "../components/ui/DataTableSkeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { cn } from "../lib/utils";

export function InstantAppsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [page, setPage] = useState(1);
  const { data: tags } = useInstantAppTags();
  const { data, isLoading } = useInstantApps({
    search: debouncedSearch,
    page,
    pageSize: 24,
    tag: selectedTag || undefined,
  });

  const searchTimeout = React.useRef<ReturnType<typeof setTimeout>>();
  function handleSearch(v: string) {
    setSearch(v);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 300);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <div className="bg-gradient-to-r from-primary/20 via-purple-500/10 to-surface border border-primary/30 rounded-2xl p-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text">Instant Apps</h1>
            <p className="text-text-muted text-sm">
              {data?.total?.toLocaleString() ?? "12,000+"} apps from the Winget catalog — search, pick a version, deploy to Intune
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
          <input
            type="text"
            placeholder="Search apps... (e.g. Chrome, Teams, 7-Zip, VSCode)"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            autoFocus
            className="w-full bg-surface border border-border rounded-xl pl-12 pr-4 py-3.5 text-base text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>
      </div>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSelectedTag(""); setPage(1); }}
            className={cn(
              "px-3 py-1.5 text-xs rounded-full border transition-colors",
              !selectedTag ? "bg-primary border-primary text-white" : "border-border text-text-muted hover:text-text hover:border-primary/50"
            )}
          >
            All
          </button>
          {tags.slice(0, 15).map((t) => (
            <button
              key={t.tag}
              onClick={() => { setSelectedTag(selectedTag === t.tag ? "" : t.tag); setPage(1); }}
              className={cn(
                "px-3 py-1.5 text-xs rounded-full border transition-colors",
                selectedTag === t.tag
                  ? "bg-primary border-primary text-white"
                  : "border-border text-text-muted hover:text-text hover:border-primary/50"
              )}
            >
              {t.tag} <span className="opacity-60">({t.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-surface border border-border rounded-xl p-5 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-surface-2" />
                <div className="flex-1"><div className="h-4 bg-surface-2 rounded w-3/4 mb-2" /><div className="h-3 bg-surface-2 rounded w-1/2" /></div>
              </div>
              <div className="h-6 bg-surface-2 rounded w-24 mt-2" />
            </div>
          ))}
        </div>
      ) : !data?.data.length ? (
        <EmptyState
          icon={<Package2 className="w-8 h-8" />}
          title={debouncedSearch ? `No apps found for "${debouncedSearch}"` : "Loading catalog..."}
          description={debouncedSearch ? "Try a different search term" : "The Winget catalog is syncing — this takes ~30 seconds on first run."}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.data.map((app) => {
              const initials = app.name.slice(0, 2).toUpperCase();
              return (
                <div
                  key={app.wingetId}
                  onClick={() => navigate(`/instant-apps/${encodeURIComponent(app.wingetId)}`)}
                  className="bg-surface border border-border rounded-xl p-5 cursor-pointer card-hover group"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-text text-sm truncate group-hover:text-primary transition-colors">
                        {app.name}
                      </h3>
                      <p className="text-text-muted text-xs truncate">{app.publisher}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-text-muted bg-surface-2 px-2 py-1 rounded">
                      v{app.latestVersion}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <Zap className="w-3 h-3" /> Deploy
                    </span>
                  </div>

                  {app.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {app.tags.slice(0, 3).map((t) => (
                        <span key={t} className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40">Previous</button>
              <span className="text-sm text-text-muted">Page {page} of {data.totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
