import { prisma } from "@autopack/database";
import { searchVulnerabilities, VulnerabilityResult } from "./webSearchService.js";
import { getTenantProfile, learnFromTenant } from "./tenantLearningAgent.js";
import { chatCompletion, isAIConfigured } from "./aiService.js";

export interface DepartmentImpact {
  department: string;
  groupId: string;
  groupName: string;
  deviceCount: number;
  riskLevel: "critical" | "high" | "medium" | "low";
  reason: string;
}

export interface RiskEntry {
  appName: string;
  publisher: string;
  installedVersion: string;
  latestVersion: string;
  deviceCount: number;
  vulnerabilities: VulnerabilityResult[];
  departmentImpact: DepartmentImpact[];
  overallRisk: "critical" | "high" | "medium" | "low";
  recommendation: string;
  updateUrgency: "immediate" | "within_week" | "next_cycle" | "low_priority";
}

export interface RiskSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalApps: number;
  totalDevicesAtRisk: number;
  departmentBreakdown: Record<string, { critical: number; high: number; medium: number; low: number }>;
}

export async function analyzeRisks(tenantId: string): Promise<{ entries: RiskEntry[]; summary: RiskSummary }> {
  console.log(`[RiskAgent] Starting analysis for tenant ${tenantId}`);

  // Ensure tenant profile exists
  let profile = await getTenantProfile(tenantId);
  if (!profile || !profile.lastLearnedAt) {
    await learnFromTenant(tenantId);
    profile = await getTenantProfile(tenantId);
  }

  const groupClassifications = (profile?.groupClassifications ?? {}) as Record<string, any>;
  const appUsagePatterns = (profile?.appUsagePatterns ?? {}) as Record<string, any>;

  // Get outdated apps from radar
  const discoveries = await prisma.deviceDiscovery.findMany({
    where: { tenantId },
    orderBy: { deviceCount: "desc" },
  });

  // Get instant apps catalog for version comparison
  const instantApps = await prisma.instantApp.findMany({
    select: { name: true, latestVersion: true, publisher: true },
  });
  const catalogMap = new Map(instantApps.map((a) => [a.name.toLowerCase(), a]));

  // Find outdated apps
  const outdatedApps: { disc: typeof discoveries[0]; latest: string; catalogPub: string }[] = [];
  for (const disc of discoveries) {
    const match = catalogMap.get(disc.appName.toLowerCase());
    if (match && match.latestVersion && disc.installedVersion && match.latestVersion !== disc.installedVersion) {
      outdatedApps.push({ disc, latest: match.latestVersion, catalogPub: match.publisher ?? disc.publisher ?? "" });
    }
  }

  console.log(`[RiskAgent] Found ${outdatedApps.length} outdated apps, analyzing top 20...`);

  // Analyze top 20 by device count
  const entries: RiskEntry[] = [];
  const topApps = outdatedApps.slice(0, 20);

  for (const { disc, latest, catalogPub } of topApps) {
    const vulns = await searchVulnerabilities(disc.appName, disc.installedVersion ?? "");

    const departmentImpact = buildDepartmentImpact(disc.appName, disc.deviceCount, vulns, groupClassifications, appUsagePatterns);

    const overallRisk = computeOverallRisk(vulns, departmentImpact, disc.deviceCount);
    const recommendation = generateRecommendation(disc.appName, overallRisk, departmentImpact, vulns);
    const updateUrgency = riskToUrgency(overallRisk);

    entries.push({
      appName: disc.appName,
      publisher: catalogPub,
      installedVersion: disc.installedVersion ?? "unknown",
      latestVersion: latest,
      deviceCount: disc.deviceCount,
      vulnerabilities: vulns,
      departmentImpact,
      overallRisk,
      recommendation,
      updateUrgency,
    });
  }

  // Enrich with AI-generated insights
  if (isAIConfigured() && entries.length > 0) {
    try {
      await aiEnrichEntries(entries);
    } catch (err: any) {
      console.warn("[RiskAgent] AI enrichment failed, using heuristic recommendations:", err.message);
    }
  }

  entries.sort((a, b) => riskWeight(b.overallRisk) - riskWeight(a.overallRisk));

  const summary = buildSummary(entries);

  // Cache the report (24h)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.riskReport.create({
    data: { tenantId, entries: entries as any, summary: summary as any, expiresAt },
  });

  console.log(`[RiskAgent] Analysis complete — ${summary.critical} critical, ${summary.high} high, ${summary.medium} medium`);
  return { entries, summary };
}

function buildDepartmentImpact(
  appName: string,
  totalDevices: number,
  vulns: VulnerabilityResult[],
  groups: Record<string, any>,
  appUsage: Record<string, any>
): DepartmentImpact[] {
  const impacts: DepartmentImpact[] = [];
  const groupEntries = Object.values(groups) as any[];
  const maxSeverity = vulns.length ? vulns[0].severity : "low";

  // Distribute devices across departments proportionally
  const departments = new Map<string, { groupId: string; groupName: string; count: number }>();
  for (const g of groupEntries) {
    const existing = departments.get(g.department);
    if (!existing) {
      departments.set(g.department, { groupId: g.groupId, groupName: g.groupName, count: Math.ceil(totalDevices / groupEntries.length) });
    }
  }

  if (departments.size === 0) {
    departments.set("All Users", { groupId: "all", groupName: "All Users", count: totalDevices });
  }

  for (const [dept, info] of departments) {
    const deptRisk = computeDepartmentRisk(dept, maxSeverity, appName);
    const reason = generateDepartmentReason(dept, appName, vulns);

    impacts.push({
      department: dept,
      groupId: info.groupId,
      groupName: info.groupName,
      deviceCount: info.count,
      riskLevel: deptRisk,
      reason,
    });
  }

  return impacts.sort((a, b) => riskWeight(b.riskLevel) - riskWeight(a.riskLevel));
}

function computeDepartmentRisk(department: string, vulnSeverity: string, appName: string): DepartmentImpact["riskLevel"] {
  const highRiskDepts = ["Finance", "Executive", "Legal", "HR"];
  const appLower = appName.toLowerCase();
  const isBrowser = ["chrome", "firefox", "edge", "brave"].some((b) => appLower.includes(b));
  const isOffice = ["office", "outlook", "word", "excel", "teams"].some((o) => appLower.includes(o));

  if (vulnSeverity === "critical") {
    return highRiskDepts.includes(department) ? "critical" : "high";
  }

  if (vulnSeverity === "high") {
    if (highRiskDepts.includes(department) && (isBrowser || isOffice)) return "critical";
    return highRiskDepts.includes(department) ? "high" : "medium";
  }

  if (department === "Development" || department === "IT") return "low";
  return "medium";
}

function generateDepartmentReason(dept: string, appName: string, vulns: VulnerabilityResult[]): string {
  const appLower = appName.toLowerCase();
  const hasExploit = vulns.some((v) => v.exploitAvailable);
  const isBrowser = ["chrome", "firefox", "edge"].some((b) => appLower.includes(b));

  if (dept === "Finance" && isBrowser) {
    return `Finance team uses browsers for banking and payment systems${hasExploit ? " — active exploits increase credential theft risk" : ""}`;
  }
  if (dept === "Finance") {
    return `Finance handles sensitive financial data — unpatched software increases data exfiltration risk`;
  }
  if (dept === "Executive") {
    return `Executive devices contain strategic information — high-value targets for attackers`;
  }
  if (dept === "HR") {
    return `HR systems contain PII (personal identifiable information) — compliance risk if breached`;
  }
  if (dept === "Development" || dept === "IT") {
    return `Technical teams can often mitigate risks through workarounds — lower immediate urgency`;
  }
  return `Outdated ${appName} may expose this department to known vulnerabilities`;
}

function generateRecommendation(appName: string, risk: RiskEntry["overallRisk"], impacts: DepartmentImpact[], vulns: VulnerabilityResult[]): string {
  const hasExploit = vulns.some((v) => v.exploitAvailable);
  const criticalDepts = impacts.filter((i) => i.riskLevel === "critical").map((i) => i.department);

  if (risk === "critical" && hasExploit) {
    return `URGENT: Active exploits exist. Deploy update immediately to ${criticalDepts.join(", ")} first, then all devices.`;
  }
  if (risk === "critical") {
    return `Update ${appName} within 24 hours. Prioritize ${criticalDepts.join(", ")} departments.`;
  }
  if (risk === "high") {
    return `Schedule update within this week. ${criticalDepts.length ? `Start with ${criticalDepts.join(", ")}.` : "Use phased deployment."}`;
  }
  if (risk === "medium") {
    return `Include in next patch cycle. Monitor for escalation.`;
  }
  return `Low priority — update at convenience during next maintenance window.`;
}

function computeOverallRisk(vulns: VulnerabilityResult[], impacts: DepartmentImpact[], deviceCount: number): RiskEntry["overallRisk"] {
  const maxVulnSeverity = vulns.length ? riskWeight(vulns[0].severity) : 1;
  const maxDeptRisk = impacts.length ? riskWeight(impacts[0].riskLevel) : 1;
  const hasExploit = vulns.some((v) => v.exploitAvailable);
  const scale = deviceCount > 50 ? 1.2 : deviceCount > 20 ? 1.1 : 1;

  const score = Math.max(maxVulnSeverity, maxDeptRisk) * scale + (hasExploit ? 1 : 0);

  if (score >= 4.5) return "critical";
  if (score >= 3) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function riskToUrgency(risk: RiskEntry["overallRisk"]): RiskEntry["updateUrgency"] {
  switch (risk) {
    case "critical": return "immediate";
    case "high": return "within_week";
    case "medium": return "next_cycle";
    default: return "low_priority";
  }
}

function riskWeight(level: string): number {
  switch (level) {
    case "critical": return 4;
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    default: return 0;
  }
}

function buildSummary(entries: RiskEntry[]): RiskSummary {
  const summary: RiskSummary = {
    critical: 0, high: 0, medium: 0, low: 0,
    totalApps: entries.length,
    totalDevicesAtRisk: 0,
    departmentBreakdown: {},
  };

  for (const entry of entries) {
    summary[entry.overallRisk]++;
    summary.totalDevicesAtRisk += entry.deviceCount;

    for (const impact of entry.departmentImpact) {
      if (!summary.departmentBreakdown[impact.department]) {
        summary.departmentBreakdown[impact.department] = { critical: 0, high: 0, medium: 0, low: 0 };
      }
      summary.departmentBreakdown[impact.department][impact.riskLevel]++;
    }
  }

  return summary;
}

async function aiEnrichEntries(entries: RiskEntry[]): Promise<void> {
  const appsData = entries.slice(0, 10).map((e) => ({
    app: e.appName,
    from: e.installedVersion,
    to: e.latestVersion,
    devices: e.deviceCount,
    vulns: e.vulnerabilities.map((v) => v.cveId ?? v.title).slice(0, 3),
    departments: e.departmentImpact.map((d) => `${d.department} (${d.riskLevel})`),
  }));

  const response = await chatCompletion(
    `You are a cybersecurity analyst for an enterprise IT department. You assess risk of outdated software across departments.

For each app, provide:
1. "recommendation" — 1-2 sentences: what to do, which department to prioritize, and WHY (mention specific risks like credential theft, data exfiltration, compliance violation, ransomware entry point)
2. "departmentReasons" — object mapping department name to a specific reason WHY this app is risky FOR THAT department (not generic — mention what they DO with the app)

Respond ONLY with valid JSON array matching the input order. No markdown.
Example: [{"recommendation":"...","departmentReasons":{"Finance":"...","HR":"..."}}]`,
    JSON.stringify(appsData),
    { temperature: 0.4, maxTokens: 3000 }
  );

  try {
    const parsed = JSON.parse(response.trim());
    for (let i = 0; i < Math.min(parsed.length, entries.length); i++) {
      if (parsed[i].recommendation) {
        entries[i].recommendation = parsed[i].recommendation;
      }
      if (parsed[i].departmentReasons) {
        for (const impact of entries[i].departmentImpact) {
          const aiReason = parsed[i].departmentReasons[impact.department];
          if (aiReason) impact.reason = aiReason;
        }
      }
    }
    console.log(`[RiskAgent] AI enriched ${parsed.length} entries with contextual recommendations`);
  } catch {
    console.warn("[RiskAgent] Failed to parse AI enrichment response");
  }
}

export async function getCachedReport(tenantId: string) {
  return prisma.riskReport.findFirst({
    where: { tenantId, expiresAt: { gt: new Date() } },
    orderBy: { generatedAt: "desc" },
  });
}
