import React, { useState, useEffect } from "react";
import { Settings, Save, ChevronDown, Users, Plus, Trash2, Search, Shield, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useTenant } from "../contexts/TenantContext";
import { useApps } from "../hooks/useApps";
import { usePermission } from "../hooks/usePermission";
import { useAuth } from "../contexts/AuthContext";

const DEFAULT_PSADT = `# PSADT Pre-Install Script Template
$appName    = "AppName"
$appVersion = "1.0.0"
Get-Process -Name $appName -ErrorAction SilentlyContinue | Stop-Process -Force
`;

export function SettingsPage() {
  const { activeTenantId } = useTenant();
  const { user: currentUser } = useAuth();
  const canEdit = usePermission("SETTINGS_EDIT");
  const isAdmin = currentUser?.role === "Admin";
  const { data: appsData } = useApps({ pageSize: 100 });

  const [tab, setTab] = useState<"apps" | "access">(isAdmin ? "access" : "apps");

  // ── App Settings state ──────────────────────────────────────────────────────
  const [selectedAppId, setSelectedAppId] = useState("");
  const [settings, setSettings] = useState({ installArgs: "", preScript: DEFAULT_PSADT, postScript: "", registryValues: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedAppId || !activeTenantId) return;
    setLoading(true);
    api.get(`/settings/app/${selectedAppId}`, { params: { tenantId: activeTenantId } })
      .then((r) => {
        setSettings({
          installArgs: r.data.installArgs ?? "",
          preScript: r.data.preScript ?? DEFAULT_PSADT,
          postScript: r.data.postScript ?? "",
          registryValues: r.data.registryValues ? JSON.stringify(r.data.registryValues, null, 2) : "",
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedAppId, activeTenantId]);

  async function handleSave() {
    if (!selectedAppId) return;
    setSaving(true);
    try {
      let registryValues = null;
      if (settings.registryValues.trim()) {
        try { registryValues = JSON.parse(settings.registryValues); } catch { toast.error("Invalid JSON"); setSaving(false); return; }
      }
      await api.put(`/settings/app/${selectedAppId}`, {
        tenantId: activeTenantId,
        installArgs: settings.installArgs || null,
        preScript: settings.preScript || null,
        postScript: settings.postScript || null,
        registryValues,
      });
      toast.success("Settings saved!");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ── Access Management state ─────────────────────────────────────────────────
  const [allowedUsers, setAllowedUsers] = useState<any[]>([]);
  const [entraSearch, setEntraSearch] = useState("");
  const [entraResults, setEntraResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [grantRole, setGrantRole] = useState<"Admin" | "Member">("Member");

  useEffect(() => {
    if (tab === "access" && isAdmin) loadAllowedUsers();
  }, [tab]);

  async function loadAllowedUsers() {
    setLoadingUsers(true);
    try {
      const { data } = await api.get("/auth/users");
      setAllowedUsers(data);
    } catch { /* ignore */ }
    setLoadingUsers(false);
  }

  const searchTimeout = React.useRef<ReturnType<typeof setTimeout>>();
  function handleEntraSearch(q: string) {
    setEntraSearch(q);
    clearTimeout(searchTimeout.current);
    if (q.length < 2) { setEntraResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get("/auth/users/search-entra", { params: { q } });
        setEntraResults(data);
      } catch {
        setEntraResults([]);
      }
      setSearching(false);
    }, 400);
  }

  async function grantAccess(user: { email: string; name: string; azureObjectId?: string }) {
    try {
      await api.post("/auth/users/grant", { ...user, role: grantRole });
      toast.success(`Access granted to ${user.name}`);
      setEntraSearch("");
      setEntraResults([]);
      loadAllowedUsers();
    } catch {
      toast.error("Failed to grant access");
    }
  }

  async function revokeAccess(userId: string, name: string) {
    if (!confirm(`Revoke access for ${name}?`)) return;
    try {
      await api.delete(`/auth/users/${userId}`);
      toast.success(`Access revoked for ${name}`);
      loadAllowedUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Failed to revoke");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Settings</h1>
        <p className="text-text-muted text-sm mt-1">App configuration and access management</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 p-1 rounded-xl w-fit">
        {isAdmin && (
          <button
            onClick={() => setTab("access")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "access" ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
            }`}
          >
            <Shield className="w-4 h-4" />
            Access Management
          </button>
        )}
        <button
          onClick={() => setTab("apps")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "apps" ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
          }`}
        >
          <Settings className="w-4 h-4" />
          App Settings
        </button>
      </div>

      {/* ── Access Management ────────────────────────────────────────────────── */}
      {tab === "access" && isAdmin && (
        <div className="space-y-5">
          {/* Grant access — search Entra */}
          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
              Grant Access
            </h2>
            <p className="text-text-muted text-xs mb-4">
              Search your Entra directory to find and add users. Only users added here can sign in to PatchMate.
            </p>

            <div className="flex gap-3 items-end">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  value={entraSearch}
                  onChange={(e) => handleEntraSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full bg-surface-2 border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <select
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value as "Admin" | "Member")}
                className="bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text"
              >
                <option value="Member">Member</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            {/* Search results */}
            {(entraResults.length > 0 || searching) && (
              <div className="mt-3 bg-surface-2 border border-border rounded-lg overflow-hidden">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-text-muted">Searching Entra directory...</div>
                ) : (
                  entraResults.map((u) => (
                    <div key={u.azureObjectId} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface transition-colors">
                      <div>
                        <p className="text-sm font-medium text-text">{u.name}</p>
                        <p className="text-xs text-text-muted">{u.email}</p>
                      </div>
                      <button
                        onClick={() => grantAccess(u)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Grant {grantRole}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Manual add */}
            {entraSearch.length >= 2 && entraResults.length === 0 && !searching && (
              <div className="mt-3 bg-surface-2 border border-border rounded-lg px-4 py-3">
                <p className="text-xs text-text-muted mb-2">Not found in Entra? Add manually:</p>
                <button
                  onClick={() => grantAccess({ email: entraSearch.includes("@") ? entraSearch : `${entraSearch}@unknown`, name: entraSearch })}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  + Add "{entraSearch}" as {grantRole}
                </button>
              </div>
            )}
          </div>

          {/* Current allowed users */}
          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
              Allowed Users ({allowedUsers.length})
            </h2>

            {loadingUsers ? (
              <div className="space-y-3 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-surface-2 rounded-lg" />
                ))}
              </div>
            ) : allowedUsers.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-6">No users have been granted access yet.</p>
            ) : (
              <div className="space-y-2">
                {allowedUsers.map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-3 px-4 bg-surface-2 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                        {u.name?.slice(0, 2).toUpperCase() ?? "??"}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text">{u.name}</p>
                        <p className="text-xs text-text-muted">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        u.role === "Admin"
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-surface text-text-muted border-border"
                      }`}>
                        {u.role}
                      </span>
                      <button
                        onClick={() => revokeAccess(u.id, u.name)}
                        className="p-1.5 text-text-muted hover:text-red-400 rounded transition-colors"
                        title="Revoke access"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── App Settings ─────────────────────────────────────────────────────── */}
      {tab === "apps" && (
        <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Select Application</label>
              <div className="relative">
                <select
                  value={selectedAppId}
                  onChange={(e) => setSelectedAppId(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none pr-8"
                >
                  <option value="">Choose an application...</option>
                  {appsData?.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              </div>
            </div>
            {canEdit && selectedAppId && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-black text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                {saving ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <><Save className="w-4 h-4" />Save</>}
              </button>
            )}
          </div>

          {selectedAppId && (
            loading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-10 bg-surface-2 rounded-lg" />
                <div className="h-40 bg-surface-2 rounded-lg" />
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">Extra Install Arguments</label>
                  <input
                    value={settings.installArgs}
                    onChange={(e) => setSettings((p) => ({ ...p, installArgs: e.target.value }))}
                    disabled={!canEdit}
                    placeholder="/S /norestart ALLUSERS=1"
                    className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                  />
                </div>

                {[
                  { key: "preScript", label: "Pre-Install Script (PowerShell)" },
                  { key: "postScript", label: "Post-Install Script (PowerShell)" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-text-muted mb-1.5">{label}</label>
                    <textarea
                      value={(settings as any)[key]}
                      onChange={(e) => setSettings((p) => ({ ...p, [key]: e.target.value }))}
                      disabled={!canEdit}
                      rows={6}
                      className="w-full bg-black border border-border rounded-lg px-4 py-3 text-sm font-mono text-green-300 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60 resize-y"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1.5">Registry Values (JSON)</label>
                  <textarea
                    value={settings.registryValues}
                    onChange={(e) => setSettings((p) => ({ ...p, registryValues: e.target.value }))}
                    disabled={!canEdit}
                    rows={3}
                    placeholder='{"HKLM\\SOFTWARE\\App\\Version": "1.0"}'
                    className="w-full bg-black border border-border rounded-lg px-4 py-3 text-sm font-mono text-green-300 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60 resize-y"
                  />
                </div>
              </div>
            )
          )}

          {!selectedAppId && (
            <div className="flex flex-col items-center py-10 text-center">
              <Settings className="w-10 h-10 text-text-muted mb-3" />
              <p className="text-text-muted text-sm">Select an application to configure</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
