import React, { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";

interface TerminalLogProps {
  lines: string[];
  className?: string;
  maxHeight?: string;
}

export function TerminalLog({ lines, className, maxHeight = "400px" }: TerminalLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      className={cn(
        "bg-black rounded-lg border border-border font-mono text-sm overflow-y-auto p-4",
        className
      )}
      style={{ maxHeight }}
    >
      {lines.length === 0 ? (
        <span className="text-text-muted">Waiting for output...</span>
      ) : (
        lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "leading-relaxed whitespace-pre-wrap",
              line.includes("[RESULT] PASSED") || line.includes("✓") ? "text-green-400 font-semibold" :
              line.includes("[RESULT] FAILED") || line.includes("✗") || line.includes("ERROR") ? "text-red-400" :
              line.startsWith("[VM]") ? "text-cyan-400" :
              line.startsWith("[AutoPack]") ? "text-purple-400" :
              "text-green-300"
            )}
          >
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
