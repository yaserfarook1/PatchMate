import { Router } from "express";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import authRouter from "./auth.js";
import appsRouter from "./apps.js";
import packagesRouter from "./packages.js";
import tenantsRouter from "./tenants.js";
import flowsRouter from "./flows.js";
import radarRouter from "./radar.js";
import settingsRouter from "./settings.js";
import instantAppsRouter from "./instantApps.js";
import riskRouter from "./risk.js";

const router = Router();

router.use("/auth", authRouter);
router.use("/apps", appsRouter);
router.use("/packages", packagesRouter);
router.use("/tenants", tenantsRouter);
router.use("/flows", flowsRouter);
router.use("/radar", radarRouter);
router.use("/settings", settingsRouter);
router.use("/instant-apps", instantAppsRouter);
router.use("/risk", riskRouter);

router.get("/dashboard/stats", requireAuth, async (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  const where: any = tenantId ? { tenantId } : {};

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalPackages, tenantsCount, runningJobs, deploymentsThisWeek, packagesByStatus, discoveredApps, catalogApps] = await Promise.all([
    prisma.package.count({ where }),
    prisma.tenant.count(),
    prisma.package.count({ where: { ...where, validationStatus: "running" } }),
    prisma.deploymentJob.count({ where: { createdAt: { gte: weekAgo }, status: "completed" } }),
    prisma.package.groupBy({ by: ["validationStatus"], _count: { id: true }, where }),
    tenantId ? prisma.deviceDiscovery.findMany({ where: { tenantId } }) : Promise.resolve([]),
    prisma.app.findMany({ select: { name: true, latestVersion: true } }),
  ]);

  // Count outdated apps (installed version < catalog latest)
  const normalise = (n: string) =>
    n.toLowerCase().replace(/\s*(x86|x64|64-bit|32-bit|\(64-bit\))\s*/gi, "").replace(/[^a-z0-9]/g, "");
  const parseVer = (v: string) => v.split(/[.\-_]/).map((s) => parseInt(s.replace(/\D/g, "")) || 0);
  const isOlder = (a: string, b: string) => {
    const pa = parseVer(a); const pb = parseVer(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d < 0;
    }
    return false;
  };
  const catMap = new Map(catalogApps.map((a) => [normalise(a.name), a.latestVersion]));
  const appsNeedingUpdate = discoveredApps.filter((d) => {
    const latest = catMap.get(normalise(d.appName));
    return latest && isOlder(d.installedVersion, latest);
  }).length;

  res.json({
    totalPackages,
    activeTenantsCount: tenantsCount,
    runningJobs,
    deploymentsThisWeek,
    appsNeedingUpdate,
    packagesByStatus: packagesByStatus.map((p) => ({ status: p.validationStatus, count: p._count.id })),
  });
});

router.get("/audit-logs", requireAuth, async (req, res) => {
  const { limit = "15", page = "1" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const size = parseInt(limit);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      take: size,
      skip: (pageNum - 1) * size,
      orderBy: { timestamp: "desc" },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  res.json({ data: logs, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) });
});

export default router;
