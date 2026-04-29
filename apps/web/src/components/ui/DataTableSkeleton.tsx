import React from "react";
import { cn } from "../../lib/utils";

interface DataTableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function DataTableSkeleton({ rows = 8, columns = 5, className }: DataTableSkeletonProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 rounded-lg bg-surface animate-pulse">
          {Array.from({ length: columns }).map((_, j) => (
            <div
              key={j}
              className="h-4 bg-surface-2 rounded"
              style={{ flex: j === 0 ? 2 : 1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("p-6 rounded-xl bg-surface border border-border animate-pulse", className)}>
      <div className="h-4 bg-surface-2 rounded w-1/3 mb-3" />
      <div className="h-8 bg-surface-2 rounded w-1/2 mb-4" />
      <div className="h-3 bg-surface-2 rounded w-2/3" />
    </div>
  );
}
