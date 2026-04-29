import React from "react";
import { Bell, ChevronDown, LogOut, User, Shield } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTenant } from "../../contexts/TenantContext";
import { useTenants } from "../../hooks/useTenants";
import { cn } from "../../lib/utils";

const ROLE_COLORS: Record<string, string> = {
  Admin: "text-purple-400",
  Packager: "text-blue-400",
  Viewer: "text-text-muted",
  ServiceDesk: "text-green-400",
};

export function TopBar() {
  const { user, logout } = useAuth();
  const { activeTenantId, setActiveTenantId } = useTenant();
  const { data: tenants } = useTenants();
  const [showUserMenu, setShowUserMenu] = React.useState(false);

  const activeTenant = tenants?.find((t) => t.id === activeTenantId);

  return (
    <header className="h-16 px-6 border-b border-border bg-surface flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        {/* Tenant switcher */}
        <div className="relative">
          <select
            value={activeTenantId ?? ""}
            onChange={(e) => setActiveTenantId(e.target.value)}
            className="appearance-none bg-surface-2 border border-border rounded-lg pl-3 pr-8 py-2 text-sm text-text cursor-pointer hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {tenants?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
            {!tenants?.length && <option value="">No tenants</option>}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        </div>

        {activeTenant && (
          <span className="text-xs text-text-muted hidden sm:block">
            {activeTenant.deviceCount.toLocaleString()} devices
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-2 transition-colors">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-text leading-none">{user?.name}</p>
              <p className={cn("text-xs", ROLE_COLORS[user?.role ?? ""] ?? "text-text-muted")}>
                {user?.role}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-text-muted hidden sm:block" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium text-text">{user?.name}</p>
                <p className="text-xs text-text-muted truncate">{user?.email}</p>
              </div>
              <div className="p-1">
                <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-2 rounded-lg transition-colors">
                  <Shield className="w-4 h-4" />
                  {user?.role}
                </button>
                <button
                  onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close */}
      {showUserMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
      )}
    </header>
  );
}
