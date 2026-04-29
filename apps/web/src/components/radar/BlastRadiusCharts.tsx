import React from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  Treemap,
} from "recharts";
import { AlertTriangle, Shield, Users, Monitor, Target } from "lucide-react";
import { OutdatedApp } from "../../hooks/useRadar";

interface Props {
  outdatedApps: OutdatedApp[];
}

const SEVERITY_COLORS = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#facc15",
};

const NEON_COLORS = ["#facc15", "#06b6d4", "#10b981", "#ec4899", "#8b5cf6"];

export function BlastRadiusCharts({ outdatedApps }: Props) {
  if (!outdatedApps.length) return null;

  // Aggregate stats
  const totalAffectedDevices = outdatedApps.reduce((sum, a) => sum + a.deviceCount, 0);
  const criticalCount = outdatedApps.filter((a) => a.severity === "critical").length;
  const highCount = outdatedApps.filter((a) => a.severity === "high").length;
  const mediumCount = outdatedApps.filter((a) => a.severity === "medium").length;

  // Donut chart data — severity breakdown
  const severityData = [
    { name: "Critical", value: criticalCount, color: SEVERITY_COLORS.critical },
    { name: "High", value: highCount, color: SEVERITY_COLORS.high },
    { name: "Medium", value: mediumCount, color: SEVERITY_COLORS.medium },
  ].filter((d) => d.value > 0);

  // Bar chart — top 10 riskiest apps by device count
  const topRiskyApps = [...outdatedApps]
    .sort((a, b) => b.deviceCount - a.deviceCount)
    .slice(0, 8)
    .map((a) => ({
      name: a.appName.length > 20 ? a.appName.slice(0, 18) + "..." : a.appName,
      devices: a.deviceCount,
      severity: a.severity,
      fill: SEVERITY_COLORS[a.severity],
    }));

  // Blast radius "infection" treemap — shows proportional risk
  const treemapData = outdatedApps.slice(0, 15).map((a) => ({
    name: a.appName.length > 15 ? a.appName.slice(0, 13) + ".." : a.appName,
    size: a.deviceCount * (a.severity === "critical" ? 3 : a.severity === "high" ? 2 : 1),
    devices: a.deviceCount,
  }));

  return (
    <div className="space-y-4 mb-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="Blast Radius"
          value={`${totalAffectedDevices}`}
          sub="devices at risk"
          color="text-primary"
          glow=""
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Critical"
          value={`${criticalCount}`}
          sub="apps severely outdated"
          color="text-red-400"
          glow=""
        />
        <StatCard
          icon={<Monitor className="w-5 h-5" />}
          label="Vulnerable Apps"
          value={`${outdatedApps.length}`}
          sub="need updating"
          color="text-blue-400"
          glow=""
        />
        <StatCard
          icon={<Shield className="w-5 h-5" />}
          label="Risk Score"
          value={`${Math.min(99, Math.round((criticalCount * 30 + highCount * 10 + mediumCount * 3)))}`}
          sub="/ 100"
          color="text-pink-400"
          glow=""
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Donut — Severity breakdown */}
        <div className="bg-surface/60 backdrop-blur-sm border border-border rounded-xl p-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
            Severity Breakdown
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={severityData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={65}
                dataKey="value"
                strokeWidth={0}
              >
                {severityData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} style={{ filter: `drop-shadow(0 0 6px ${entry.color}50)` }} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0a0a14", border: "1px solid #262626", borderRadius: "8px", fontSize: "12px" }}
                itemStyle={{ color: "#e4e4e7" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-2">
            {severityData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <div className="w-2 h-2 rounded-full" style={{ background: d.color, boxShadow: `0 0 6px ${d.color}` }} />
                <span className="text-text-muted">{d.name}: {d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar — Top risky apps */}
        <div className="bg-surface/60 backdrop-blur-sm border border-border rounded-xl p-4 lg:col-span-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
            Highest Blast Radius — Devices at Risk
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={topRiskyApps} layout="vertical" margin={{ left: 0, right: 20 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: "#0a0a14", border: "1px solid #262626", borderRadius: "8px", fontSize: "12px" }}
                itemStyle={{ color: "#e4e4e7" }}
                formatter={(value: any) => [`${value} devices`, "At risk"]}
              />
              <Bar dataKey="devices" radius={[0, 4, 4, 0]}>
                {topRiskyApps.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} style={{ filter: `drop-shadow(0 0 4px ${entry.fill}40)` }} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, sub, color, glow,
}: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string; glow: string;
}) {
  return (
    <div className={`bg-surface/60 backdrop-blur-sm border border-border rounded-xl p-4 ${glow}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={color}>{icon}</div>
        <span className="text-xs text-text-muted font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-text-muted mt-0.5">{sub}</div>
    </div>
  );
}
