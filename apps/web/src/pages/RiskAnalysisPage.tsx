import React from "react";
import { Shield, AlertTriangle, RefreshCw, Brain, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { useRiskReport, useTriggerAnalysis, useTenantProfile } from "../hooks/useRiskAnalysis";
import { cn } from "../lib/utils";

const RISK_COLORS = {
  critical: "text-red-400 bg-red-500/10 border-red-500/30",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  low: "text-green-400 bg-green-500/10 border-green-500/30",
};

const RISK_DOTS = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
};

export default function RiskAnalysisPage() {
  const { data: report, isLoading } = useRiskReport();
  const { mutate: triggerAnalysis, isPending: analyzing } = useTriggerAnalysis();
  const { data: profile } = useTenantProfile();
  const [expandedApps, setExpandedApps] = React.useState<Set<string>>(new Set());

  const entries = report?.entries ?? [];
  const summary = report?.summary;

  const toggle = (appName: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      next.has(appName) ? next.delete(appName) : next.add(appName);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Risk Analysis
          </h1>
          <p className="text-sm text-text-muted mt-1">
            AI-powered vulnerability assessment with department-level impact scoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profile?.exists && (
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Brain className="w-3.5 h-3.5" />
              Profile: {Object.keys(profile.groupClassifications ?? {}).length} groups learned
            </span>
          )}
          <button
            onClick={() => triggerAnalysis()}
            disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-black rounded-lg font-medium text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("w-4 h-4", analyzing && "animate-spin")} />
            {analyzing ? "Analyzing..." : "Run Analysis"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard label="Critical" count={summary.critical} color="red" />
          <SummaryCard label="High" count={summary.high} color="orange" />
          <SummaryCard label="Medium" count={summary.medium} color="yellow" />
          <SummaryCard label="Low" count={summary.low} color="green" />
          <SummaryCard label="Devices at Risk" count={summary.totalDevicesAtRisk} color="purple" />
        </div>
      )}

      {/* Department Breakdown */}
      {summary?.departmentBreakdown && Object.keys(summary.departmentBreakdown).length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-text mb-3">Department Risk Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(summary.departmentBreakdown).map(([dept, counts]: [string, any]) => (
              <div key={dept} className="bg-surface-2 rounded-lg p-3">
                <p className="text-sm font-medium text-text">{dept}</p>
                <div className="flex gap-2 mt-1.5 text-xs">
                  {counts.critical > 0 && <span className="text-red-400">{counts.critical} crit</span>}
                  {counts.high > 0 && <span className="text-orange-400">{counts.high} high</span>}
                  {counts.medium > 0 && <span className="text-yellow-400">{counts.medium} med</span>}
                  {counts.low > 0 && <span className="text-green-400">{counts.low} low</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading / Empty */}
      {isLoading && <div className="text-center py-12 text-text-muted">Loading...</div>}
      {!isLoading && entries.length === 0 && (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
          <Shield className="w-12 h-12 text-text-muted mx-auto mb-3" />
          <p className="text-text font-medium">No risk report yet</p>
          <p className="text-sm text-text-muted mt-1">Run a Radar scan first, then click "Run Analysis" to assess vulnerabilities</p>
        </div>
      )}

      {/* Risk Entries */}
      {entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((entry: any) => {
            const expanded = expandedApps.has(entry.appName);
            return (
              <div key={entry.appName} className={cn("border rounded-xl overflow-hidden transition-colors", RISK_COLORS[entry.overallRisk as keyof typeof RISK_COLORS])}>
                {/* Header */}
                <button
                  onClick={() => toggle(entry.appName)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  {expanded ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", RISK_DOTS[entry.overallRisk as keyof typeof RISK_DOTS])} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-text">{entry.appName}</span>
                    <span className="text-xs text-text-muted ml-2">{entry.installedVersion} → {entry.latestVersion}</span>
                  </div>
                  <span className="text-xs text-text-muted">{entry.deviceCount} devices</span>
                  <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded-full bg-black/20">{entry.overallRisk}</span>
                </button>

                {/* Expanded details */}
                {expanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/5">
                    {/* Vulnerabilities */}
                    {entry.vulnerabilities?.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-text-muted uppercase mb-2">Vulnerabilities Found</p>
                        {entry.vulnerabilities.map((v: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm mb-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-current" />
                            <div>
                              <span className="text-text">{v.cveId ? `${v.cveId} — ` : ""}{v.title}</span>
                              {v.exploitAvailable && <span className="ml-1.5 text-xs text-red-400 font-semibold">EXPLOIT AVAILABLE</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Department Impact */}
                    {entry.departmentImpact?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-text-muted uppercase mb-2">Department Impact</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {entry.departmentImpact.map((d: any, i: number) => (
                            <div key={i} className="bg-black/20 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-text">{d.department}</span>
                                <span className={cn("text-xs font-semibold uppercase", `text-${d.riskLevel === "critical" ? "red" : d.riskLevel === "high" ? "orange" : d.riskLevel === "medium" ? "yellow" : "green"}-400`)}>{d.riskLevel}</span>
                              </div>
                              <p className="text-xs text-text-muted mt-1">{d.reason}</p>
                              <p className="text-xs text-text-muted">{d.deviceCount} devices affected</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendation */}
                    <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
                      <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <p className="text-sm text-text">{entry.recommendation}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cache info */}
      {report?.generatedAt && (
        <p className="text-xs text-text-muted text-center">
          Report generated: {new Date(report.generatedAt).toLocaleString()}
          {report.cached && " (cached — valid for 24h)"}
        </p>
      )}
    </div>
  );
}

function SummaryCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={cn("text-2xl font-bold", `text-${color}-400`)}>{count}</p>
    </div>
  );
}
