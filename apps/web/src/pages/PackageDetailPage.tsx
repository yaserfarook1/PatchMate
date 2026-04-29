import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Terminal, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { usePackage } from "../hooks/usePackages";
import { getSocket } from "../lib/socket";
import { StatusBadge } from "../components/ui/StatusBadge";
import { TerminalLog } from "../components/ui/TerminalLog";
import { JobProgressPayload, JobCompletePayload, JobFailedPayload } from "@autopack/shared";
import { formatDistanceToNow } from "date-fns";
import { cn } from "../lib/utils";

export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: pkg, isLoading } = usePackage(id);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!id) return;
    const socket = getSocket();

    socket.emit("join:job", id);

    function onProgress(p: JobProgressPayload) {
      if (p.packageId !== id) return;
      setLogLines((prev) => [...prev, p.logLine]);
      setProgress(p.percent);
    }

    function onComplete(p: JobCompletePayload) {
      if (p.packageId !== id) return;
      setProgress(100);
      toast.success("Package built successfully!");
      qc.invalidateQueries({ queryKey: ["package", id] });
    }

    function onFailed(p: JobFailedPayload) {
      if (p.packageId !== id) return;
      toast.error(p.error);
      qc.invalidateQueries({ queryKey: ["package", id] });
    }

    socket.on("job:progress", onProgress);
    socket.on("job:complete", onComplete);
    socket.on("job:failed", onFailed);

    return () => {
      socket.off("job:progress", onProgress);
      socket.off("job:complete", onComplete);
      socket.off("job:failed", onFailed);
    };
  }, [id, qc]);

  useEffect(() => {
    if (pkg?.validationLog && logLines.length === 0) {
      setLogLines(pkg.validationLog.split("\n"));
    }
  }, [pkg?.validationLog]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-surface rounded w-1/3" />
        <div className="h-64 bg-surface rounded-xl" />
      </div>
    );
  }

  if (!pkg) return <div className="text-text-muted">Package not found</div>;

  const isRunning = pkg.validationStatus === "running" || pkg.validationStatus === "pending";
  const isPassed = pkg.validationStatus === "passed";
  const isFailed = pkg.validationStatus === "failed";

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={() => navigate("/packages")}
        className="flex items-center gap-2 text-text-muted hover:text-text text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Packages
      </button>

      {/* Header */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">{pkg.app?.name}</h1>
            <p className="text-text-muted">{pkg.app?.publisher}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs font-mono bg-surface-2 px-2 py-1 rounded">v{pkg.version}</span>
              <span className="text-xs text-text-muted">{(pkg as any).tenant?.displayName}</span>
              {pkg.fileSize && <span className="text-xs text-text-muted">{Math.round(pkg.fileSize / 1024)} KB</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={pkg.validationStatus} />
            {isPassed && pkg.intuneWinPath && (
              <a
                href={`/api/packages/${pkg.id}/download`}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Download .intunewin
              </a>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-text-muted mb-1.5">
              <span>Building package...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Status message */}
        {isPassed && (
          <div className="mt-4 flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Package validated and ready for deployment
          </div>
        )}
        {isFailed && (
          <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
            <XCircle className="w-4 h-4" />
            Validation failed — see logs below
          </div>
        )}
      </div>

      {/* Package metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Install Command", value: pkg.installCmd },
          { label: "Uninstall Command", value: pkg.uninstallCmd },
          { label: "Detection Method", value: pkg.detectionMethod },
          { label: "Created", value: pkg.createdAt ? formatDistanceToNow(new Date(pkg.createdAt), { addSuffix: true }) : "-" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface border border-border rounded-xl p-4">
            <p className="text-xs text-text-muted font-medium mb-1.5">{label}</p>
            <p className="text-sm font-mono text-text break-all">{value || "-"}</p>
          </div>
        ))}
      </div>

      {/* Terminal logs */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Terminal className="w-4 h-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Packaging Logs</h2>
          {isRunning && (
            <div className="ml-auto flex items-center gap-1.5 text-xs text-blue-400">
              <Clock className="w-3 h-3 animate-spin" />
              Live
            </div>
          )}
        </div>
        <TerminalLog lines={logLines} maxHeight="450px" />
      </div>
    </div>
  );
}
