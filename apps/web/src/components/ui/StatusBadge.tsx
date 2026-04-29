import React from "react";
import { cn } from "../../lib/utils";

type Status =
  | "validated"
  | "pending"
  | "failed"
  | "passed"
  | "running"
  | "queued"
  | "completed"
  | "active";

const STATUS_CONFIG: Record<Status, { label: string; className: string; dot: string }> = {
  validated: { label: "Package Ready",  className: "bg-green-500/10 text-green-400 border border-green-500/20", dot: "bg-green-400" },
  passed:    { label: "Ready",          className: "bg-green-500/10 text-green-400 border border-green-500/20", dot: "bg-green-400" },
  completed: { label: "Completed",      className: "bg-green-500/10 text-green-400 border border-green-500/20", dot: "bg-green-400" },
  active:    { label: "Active",         className: "bg-blue-500/10 text-blue-400 border border-blue-500/20", dot: "bg-blue-400" },
  running:   { label: "Building",       className: "bg-blue-500/10 text-blue-400 border border-blue-500/20", dot: "bg-blue-400 animate-pulse" },
  pending:   { label: "Not Built",      className: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20", dot: "bg-yellow-400" },
  queued:    { label: "Queued",         className: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20", dot: "bg-yellow-400" },
  failed:    { label: "Build Failed",   className: "bg-red-500/10 text-red-400 border border-red-500/20", dot: "bg-red-400" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status as Status] ?? {
    label: status,
    className: "bg-surface-2 text-text-muted border border-border",
    dot: "bg-text-muted",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
        config.className,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
