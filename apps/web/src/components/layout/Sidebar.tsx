import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package2,
  Archive,
  Building2,
  GitBranch,
  Radar,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { cn } from "../../lib/utils";

const NAV_ITEMS = [
  { label: "Dashboard",    icon: LayoutDashboard, href: "/dashboard" },
  { label: "Instant Apps", icon: Zap,             href: "/instant-apps" },
  { label: "My Catalog",   icon: Package2,        href: "/catalog" },
  { label: "Packages",     icon: Archive,         href: "/packages" },
  { label: "Tenants",     icon: Building2,       href: "/tenants" },
  { label: "Patch Flows", icon: GitBranch,       href: "/flows" },
  { label: "Radar",       icon: Radar,           href: "/radar" },
  { label: "Settings",    icon: Settings,        href: "/settings" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(
    localStorage.getItem("sidebar_collapsed") === "true"
  );
  const location = useLocation();

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar_collapsed", String(next));
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-surface border-r border-border transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 h-16 px-4 border-b border-border shrink-0">
        <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-black" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg text-primary tracking-tight">PatchMate</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const isActive = location.pathname.startsWith(href);
          return (
            <NavLink
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-text-muted hover:bg-surface-2 hover:text-text border border-transparent"
              )}
            >
              <Icon className={cn("w-5 h-5 shrink-0", isActive && "text-primary")} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-3 border-t border-border">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center p-2 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span className="ml-2 text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
