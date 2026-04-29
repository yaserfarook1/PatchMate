import { Router } from "express";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { runRadarScan } from "../services/radarService.js";

const router = Router();

// ── Version comparison (numeric segments, tolerates non-semver like 24.08) ───

function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split(/[.\-_]/).map((s) => parseInt(s.replace(/\D/g, "")) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Name normaliser for fuzzy matching ───────────────────────────────────────

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*(x86|x64|64-bit|32-bit|\(64-bit\)|\(32-bit\))\s*/gi, "")
    .replace(/\s+\d+\.\S+$/, "")   // strip trailing version from name
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ── Scan ─────────────────────────────────────────────────────────────────────

router.post("/scan/:tenantId", requireAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) {
    res.status(404).json({ code: "NOT_FOUND", message: "Tenant not found" });
    return;
  }
  res.json({ message: "Radar scan started", tenantId: req.params.tenantId });
  runRadarScan(req.params.tenantId).catch((err) =>
    console.error("Radar scan error:", err)
  );
});

// ── All discovered apps ───────────────────────────────────────────────────────

router.get("/results/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;
  const { page = "1", pageSize = "25", sort = "deviceCount", order = "desc" } =
    req.query as Record<string, string>;

  const pageNum = parseInt(page);
  const size = parseInt(pageSize);

  const allowedSorts = ["appName", "installedVersion", "deviceCount", "lastScanned"];
  const sortField = allowedSorts.includes(sort) ? sort : "deviceCount";

  const [results, total] = await Promise.all([
    prisma.deviceDiscovery.findMany({
      where: { tenantId },
      skip: (pageNum - 1) * size,
      take: size,
      orderBy: { [sortField]: order === "asc" ? "asc" : "desc" },
    }),
    prisma.deviceDiscovery.count({ where: { tenantId } }),
  ]);

  res.json({ data: results, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) });
});

// ── Outdated apps (installed < latest in Winget catalog) ─────────────────────
// Compares discovered device apps against the full 12,650+ Instant Apps catalog.

router.get("/outdated/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  // Fetch discovered apps AND the full Instant Apps catalog (12,650 entries)
  const [discovered, instantApps] = await Promise.all([
    prisma.deviceDiscovery.findMany({ where: { tenantId } }),
    prisma.instantApp.findMany({ select: { wingetId: true, name: true, latestVersion: true } }),
  ]);

  // Build lookup maps: normalised name → InstantApp
  const byName = new Map<string, { wingetId: string; name: string; latestVersion: string }>();
  for (const app of instantApps) {
    byName.set(normaliseName(app.name), app);
  }

  const outdated: {
    discoveryId: string;
    appName: string;
    publisher: string;
    installedVersion: string;
    latestVersion: string;
    deviceCount: number;
    matchedWingetId: string;
    severity: "critical" | "high" | "medium";
  }[] = [];

  for (const disc of discovered) {
    const key = normaliseName(disc.appName);
    const match = byName.get(key);
    if (!match) continue;

    if (compareVersions(disc.installedVersion, match.latestVersion) < 0) {
      const installedParts = disc.installedVersion.split(".").map(Number);
      const latestParts = match.latestVersion.split(".").map(Number);
      const majorDiff = (latestParts[0] ?? 0) - (installedParts[0] ?? 0);
      const minorDiff = (latestParts[1] ?? 0) - (installedParts[1] ?? 0);
      const severity: "critical" | "high" | "medium" =
        majorDiff >= 2 ? "critical" : majorDiff >= 1 || minorDiff >= 5 ? "high" : "medium";

      outdated.push({
        discoveryId: disc.id,
        appName: disc.appName,
        publisher: disc.publisher,
        installedVersion: disc.installedVersion,
        latestVersion: match.latestVersion,
        deviceCount: disc.deviceCount,
        matchedWingetId: match.wingetId,
        severity,
      });
    }
  }

  outdated.sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2 };
    const sDiff = sev[a.severity] - sev[b.severity];
    return sDiff !== 0 ? sDiff : b.deviceCount - a.deviceCount;
  });

  res.json({ data: outdated, total: outdated.length });
});

// ── Blast radius hierarchical data ───────────────────────────────────────────

router.get("/blast-radius/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  // Fetch groups + discovered apps in parallel
  const { getGroups } = await import("../services/graphService.js");

  let groups: { id: string; displayName: string; description: string | null }[] = [];
  try {
    groups = await getGroups(tenantId);
  } catch {
    groups = [];
  }

  const discovered = await prisma.deviceDiscovery.findMany({ where: { tenantId } });
  const instantApps = await prisma.instantApp.findMany({
    select: { wingetId: true, name: true, latestVersion: true },
  });

  const instantMap = new Map<string, string>();
  for (const ia of instantApps) {
    instantMap.set(normaliseName(ia.name), ia.latestVersion);
  }

  // Build group → app mapping (distribute apps proportionally across groups)
  const topGroups = groups.slice(0, 12);
  const totalDevices = discovered.reduce((s, d) => s + d.deviceCount, 0) || 1;

  const hierarchy = {
    name: "Blast Radius",
    children: topGroups.map((group, gi) => {
      // Assign apps to groups in a round-robin weighted fashion
      const groupApps = discovered
        .filter((_, i) => i % topGroups.length === gi)
        .map((disc) => {
          const normName = normaliseName(disc.appName);
          const latest = instantMap.get(normName);
          const isOutdated = latest && compareVersions(disc.installedVersion, latest) < 0;

          return {
            name: disc.appName,
            type: "app" as const,
            deviceCount: disc.deviceCount,
            installedVersion: disc.installedVersion,
            latestVersion: latest ?? disc.installedVersion,
            isOutdated: !!isOutdated,
            severity: isOutdated
              ? (() => {
                  const ip = disc.installedVersion.split(".").map(Number);
                  const lp = (latest ?? "").split(".").map(Number);
                  const md = (lp[0] ?? 0) - (ip[0] ?? 0);
                  return md >= 2 ? "critical" : md >= 1 ? "high" : "medium";
                })()
              : "current",
            value: Math.max(disc.deviceCount, 5),
          };
        });

      return {
        name: group.displayName,
        type: "group" as const,
        groupId: group.id,
        memberCount: groupApps.reduce((s, a) => s + a.deviceCount, 0),
        description: group.description,
        children: groupApps,
      };
    }).filter((g) => g.children.length > 0),
  };

  res.json(hierarchy);
});

// ── Bring app under management ────────────────────────────────────────────────

router.post("/:discoveryId/manage", requireAuth, async (req, res) => {
  const discovery = await prisma.deviceDiscovery.findUnique({
    where: { id: req.params.discoveryId },
  });

  if (!discovery) {
    res.status(404).json({ code: "NOT_FOUND", message: "Discovery record not found" });
    return;
  }

  const wingetId = `Managed.${discovery.appName.replace(/\s+/g, "")}`;
  const app = await prisma.app.upsert({
    where: { wingetId },
    update: {},
    create: {
      wingetId,
      name: discovery.appName,
      publisher: discovery.publisher,
      latestVersion: discovery.installedVersion,
      status: "pending",
      category: "Discovered",
    },
  });

  const flow = await prisma.patchFlow.create({
    data: {
      appId: app.id,
      tenantId: discovery.tenantId,
      name: `${discovery.appName} Management Flow`,
      autoUpdate: true,
      waves: {
        create: [
          { name: "Pilot", groupId: "group_pilot", delayHours: 0, order: 1 },
          { name: "UAT", groupId: "group_uat", delayHours: 24, order: 2 },
          { name: "Production", groupId: "group_production", delayHours: 48, order: 3 },
        ],
      },
    },
    include: { waves: { orderBy: { order: "asc" } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      action: "APP_BROUGHT_UNDER_MANAGEMENT",
      resourceType: "DeviceDiscovery",
      resourceId: discovery.id,
      details: { appName: discovery.appName, flowId: flow.id },
    },
  });

  res.status(201).json({ app, flow });
});

export default router;
