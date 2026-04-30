import { prisma } from "@autopack/database";
import { getValidToken } from "./graphService.js";
import { chatCompletion, isAIConfigured } from "./aiService.js";
import axios from "axios";

interface GroupClassification {
  groupId: string;
  groupName: string;
  department: string;
  criticality: "critical" | "high" | "standard";
  memberCount: number;
}

interface AppUsageEntry {
  groups: string[];
  deviceCount: number;
  lastSeen: string;
}

const DEPARTMENT_KEYWORDS: Record<string, string[]> = {
  Finance: ["finance", "accounting", "treasury", "billing", "payroll", "fnc", "bnk", "bank"],
  HR: ["hr", "human resources", "people", "talent", "recruit", "onboarding"],
  IT: ["it", "infra", "helpdesk", "service desk", "sysadmin", "tech", "engineering"],
  Development: ["dev", "engineer", "developer", "software", "code", "qa", "test"],
  Executive: ["exec", "leadership", "c-suite", "board", "director", "vp", "ceo", "cfo", "cto"],
  Sales: ["sales", "revenue", "business dev", "account", "client"],
  Marketing: ["marketing", "brand", "content", "social", "comms", "communications"],
  Legal: ["legal", "compliance", "audit", "risk", "governance"],
  Operations: ["operations", "ops", "logistics", "supply", "warehouse", "facilities"],
};

function keywordClassify(name: string, description?: string): { department: string; criticality: GroupClassification["criticality"] } | null {
  const text = `${name} ${description ?? ""}`.toLowerCase();
  for (const [dept, keywords] of Object.entries(DEPARTMENT_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      const criticality = dept === "Executive" ? "critical" : dept === "Finance" || dept === "Legal" ? "high" : "standard";
      return { department: dept, criticality };
    }
  }
  return null;
}

async function aiClassifyGroups(groups: { name: string; description?: string }[]): Promise<Record<string, { department: string; criticality: string }>> {
  const groupList = groups.map((g) => `- "${g.name}"${g.description ? ` (${g.description})` : ""}`).join("\n");

  const response = await chatCompletion(
    `You are an IT security analyst classifying Azure AD / Entra ID groups into departments.
For each group, determine:
1. Department: Finance, HR, IT, Development, Executive, Sales, Marketing, Legal, Operations, or General
2. Criticality: "critical" (handles sensitive data, executive access), "high" (financial/legal/compliance data), or "standard"

Respond ONLY with valid JSON — an object where keys are group names and values are { "department": "...", "criticality": "..." }. No markdown, no explanation.`,
    `Classify these groups:\n${groupList}`,
    { temperature: 0.1, maxTokens: 2000 }
  );

  try {
    return JSON.parse(response.trim());
  } catch {
    console.warn("[LearningAgent] AI classification parse failed, using fallback");
    return {};
  }
}

export async function learnFromTenant(tenantId: string): Promise<void> {
  console.log(`[LearningAgent] Building profile for tenant ${tenantId}`);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.accessToken) {
    console.warn("[LearningAgent] No tenant token — skipping");
    return;
  }

  const token = await getValidToken(tenantId);

  // 1. Fetch groups from Entra
  const rawGroups: { id: string; displayName: string; description?: string }[] = [];
  try {
    const { data } = await axios.get(
      "https://graph.microsoft.com/v1.0/groups?$select=id,displayName,description&$top=200",
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 }
    );
    rawGroups.push(...(data.value ?? []));
  } catch (err: any) {
    console.warn("[LearningAgent] Group fetch failed:", err.message);
  }

  // 2. Classify groups — keyword first, AI for unclassified
  const groupClassifications: Record<string, GroupClassification> = {};
  const unclassified: { name: string; description?: string }[] = [];

  for (const group of rawGroups) {
    const result = keywordClassify(group.displayName, group.description);
    if (result) {
      groupClassifications[group.id] = {
        groupId: group.id,
        groupName: group.displayName,
        department: result.department,
        criticality: result.criticality,
        memberCount: 0,
      };
    } else {
      unclassified.push({ name: group.displayName, description: group.description });
    }
  }

  // Use AI for ambiguous groups
  if (unclassified.length > 0 && isAIConfigured()) {
    console.log(`[LearningAgent] Using AI to classify ${unclassified.length} ambiguous groups`);
    try {
      const aiResults = await aiClassifyGroups(unclassified);
      for (const group of rawGroups) {
        if (groupClassifications[group.id]) continue;
        const ai = aiResults[group.displayName];
        groupClassifications[group.id] = {
          groupId: group.id,
          groupName: group.displayName,
          department: ai?.department ?? "General",
          criticality: (ai?.criticality as any) ?? "standard",
          memberCount: 0,
        };
      }
    } catch (err: any) {
      console.warn("[LearningAgent] AI classification failed:", err.message);
      for (const group of rawGroups) {
        if (!groupClassifications[group.id]) {
          groupClassifications[group.id] = {
            groupId: group.id, groupName: group.displayName,
            department: "General", criticality: "standard", memberCount: 0,
          };
        }
      }
    }
  } else {
    for (const group of rawGroups) {
      if (!groupClassifications[group.id]) {
        groupClassifications[group.id] = {
          groupId: group.id, groupName: group.displayName,
          department: "General", criticality: "standard", memberCount: 0,
        };
      }
    }
  }

  // 3. Build app usage patterns from device discovery
  const appUsagePatterns: Record<string, AppUsageEntry> = {};
  const discoveries = await prisma.deviceDiscovery.findMany({
    where: { tenantId },
    orderBy: { deviceCount: "desc" },
    take: 100,
  });

  const groupIds = Object.keys(groupClassifications);
  for (const disc of discoveries) {
    appUsagePatterns[disc.appName] = {
      groups: groupIds.slice(0, Math.min(3, groupIds.length)),
      deviceCount: disc.deviceCount,
      lastSeen: disc.lastScanned?.toISOString() ?? new Date().toISOString(),
    };
  }

  // 4. Upsert tenant profile
  await prisma.tenantProfile.upsert({
    where: { tenantId },
    update: { groupClassifications, appUsagePatterns, lastLearnedAt: new Date() },
    create: { tenantId, groupClassifications, appUsagePatterns, deviceProfiles: {}, lastLearnedAt: new Date() },
  });

  console.log(`[LearningAgent] Profile updated — ${Object.keys(groupClassifications).length} groups classified, ${Object.keys(appUsagePatterns).length} apps tracked`);
}

export async function getTenantProfile(tenantId: string) {
  return prisma.tenantProfile.findUnique({ where: { tenantId } });
}
