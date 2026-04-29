import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { useCreateFlow } from "../hooks/useFlows";
import { useApps } from "../hooks/useApps";
import { useTenant } from "../contexts/TenantContext";
import { useTenants } from "../hooks/useTenants";
import { useGroups, EntraGroup } from "../hooks/useGroups";
import { cn } from "../lib/utils";

interface WaveInput {
  name: string;
  groupId: string;
  groupName: string;
  delayHours: number;
  order: number;
}

const DEFAULT_WAVES: WaveInput[] = [
  { name: "Pilot", groupId: "", groupName: "", delayHours: 0, order: 1 },
  { name: "UAT", groupId: "", groupName: "", delayHours: 24, order: 2 },
  { name: "Production", groupId: "", groupName: "", delayHours: 48, order: 3 },
];

// ── Searchable Dropdown ───────────────────────────────────────────────────────

function SearchableSelect<T extends { id: string; label: string; sub?: string }>({
  items,
  value,
  onChange,
  placeholder,
  emptyText,
}: {
  items: T[];
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedItem = items.find((i) => i.id === value);
  const filtered = query
    ? items.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        (i.sub ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : items;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className={cn(
          "w-full bg-surface-2 border rounded-lg px-3 py-2 text-sm cursor-pointer flex items-center justify-between",
          open ? "border-primary/50 ring-1 ring-primary/30" : "border-border"
        )}
      >
        {selectedItem ? (
          <span className="text-text truncate">{selectedItem.label}</span>
        ) : (
          <span className="text-text-muted">{placeholder}</span>
        )}
        <Search className="w-3.5 h-3.5 text-text-muted shrink-0 ml-2" />
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search..."
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                {emptyText ?? "No results"}
              </div>
            ) : (
              filtered.slice(0, 50).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onChange(item.id, item.label);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center justify-between",
                    item.id === value && "bg-primary/5"
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-text truncate">{item.label}</p>
                    {item.sub && <p className="text-xs text-text-muted truncate">{item.sub}</p>}
                  </div>
                  {item.id === value && <Check className="w-3.5 h-3.5 text-primary shrink-0 ml-2" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function FlowNewPage() {
  const navigate = useNavigate();
  const createFlow = useCreateFlow();
  const { activeTenantId, setActiveTenantId } = useTenant();
  const { data: tenants } = useTenants();
  const { data: appsData } = useApps({ pageSize: 200 });
  const { data: groups } = useGroups(activeTenantId);
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [waves, setWaves] = useState<WaveInput[]>(DEFAULT_WAVES);

  const appItems = (appsData?.data ?? []).map((a) => ({
    id: a.id,
    label: a.name,
    sub: `${a.publisher} · v${a.latestVersion}`,
  }));

  const groupItems = (groups ?? []).map((g) => ({
    id: g.id,
    label: g.displayName,
    sub: g.description ?? undefined,
  }));

  function addWave() {
    setWaves((prev) => [...prev, { name: "", groupId: "", groupName: "", delayHours: 0, order: prev.length + 1 }]);
  }

  function removeWave(i: number) {
    setWaves((prev) => prev.filter((_, idx) => idx !== i).map((w, idx) => ({ ...w, order: idx + 1 })));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appId || !activeTenantId) {
      toast.error("Please select an app and tenant");
      return;
    }
    try {
      const flow = await createFlow.mutateAsync({ appId, tenantId: activeTenantId, name, autoUpdate, waves });
      toast.success("Patch flow created!");
      navigate(`/flows/${flow.id}`);
    } catch {
      toast.error("Failed to create flow");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <button onClick={() => navigate("/flows")} className="flex items-center gap-2 text-text-muted hover:text-text text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Flows
      </button>

      <div>
        <h1 className="text-2xl font-bold text-text">New Patch Flow</h1>
        <p className="text-text-muted text-sm mt-1">Define deployment waves for automated app patching.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Flow Name *</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Chrome Auto-Update Flow" className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Application *</label>
              <SearchableSelect
                items={appItems}
                value={appId}
                onChange={(id) => setAppId(id)}
                placeholder="Search apps..."
                emptyText="No apps found — build one from Instant Apps first"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Tenant *</label>
              <select value={activeTenantId ?? ""} onChange={(e) => setActiveTenantId(e.target.value)} className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50">
                {tenants?.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setAutoUpdate(!autoUpdate)}
              className={`w-10 h-6 rounded-full transition-colors ${autoUpdate ? "bg-primary" : "bg-surface-2 border border-border"}`}
            >
              <div className={`w-4 h-4 rounded-full mt-1 transition-all ${autoUpdate ? "ml-5 bg-black" : "ml-1 bg-white"}`} />
            </div>
            <span className="text-sm text-text">Auto-update when new version detected</span>
          </label>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Deployment Waves</h2>
            <button type="button" onClick={addWave} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
              <Plus className="w-3.5 h-3.5" />
              Add Wave
            </button>
          </div>

          <div className="space-y-3">
            {waves.map((wave, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-center">
                <input
                  value={wave.name}
                  onChange={(e) => setWaves((p) => p.map((w, idx) => idx === i ? { ...w, name: e.target.value } : w))}
                  placeholder="Wave name"
                  className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <SearchableSelect
                  items={groupItems}
                  value={wave.groupId}
                  onChange={(id, label) => setWaves((p) => p.map((w, idx) => idx === i ? { ...w, groupId: id, groupName: label } : w))}
                  placeholder="Search group..."
                  emptyText="No groups loaded — connect a tenant"
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min="0"
                    value={wave.delayHours}
                    onChange={(e) => setWaves((p) => p.map((w, idx) => idx === i ? { ...w, delayHours: parseInt(e.target.value) || 0 } : w))}
                    className="w-16 bg-surface-2 border border-border rounded-lg px-2 py-2 text-sm text-text text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="text-xs text-text-muted">h</span>
                </div>
                <button type="button" onClick={() => removeWave(i)} disabled={waves.length <= 1} className="p-1.5 text-text-muted hover:text-red-400 disabled:opacity-30 rounded transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <button type="submit" disabled={createFlow.isPending} className="w-full py-3 bg-primary hover:bg-primary-hover text-black font-semibold rounded-lg transition-colors disabled:opacity-60">
          {createFlow.isPending ? "Creating..." : "Create Flow"}
        </button>
      </form>
    </div>
  );
}
