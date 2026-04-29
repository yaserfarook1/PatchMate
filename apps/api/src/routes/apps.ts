import { Router } from "express";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { enqueuePackagingJob } from "../workers/packagingQueue.js";
import { searchWinget } from "../services/wingetService.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { search = "", category = "", page = "1", pageSize = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const size = parseInt(pageSize);
  const skip = (pageNum - 1) * size;

  const where: any = {
    // Exclude Radar discovery stubs — they have no installer and belong on the Radar page, not the catalog
    NOT: { wingetId: { startsWith: "Managed." } },
  };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { publisher: { contains: search, mode: "insensitive" } },
      { wingetId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (category) {
    where.category = category;
  }

  // Run DB query and Winget search in parallel when there's a search term
  const [dbResult, wingetResults] = await Promise.all([
    Promise.all([
      prisma.app.findMany({
        where,
        skip,
        take: size,
        orderBy: { name: "asc" },
        include: { _count: { select: { packages: true } } },
      }),
      prisma.app.count({ where }),
    ]),
    search ? searchWinget(search, 10) : Promise.resolve([]),
  ]);

  const [apps, total] = dbResult;

  // Upsert Winget results and merge with DB results (deduped by wingetId)
  if (search && wingetResults.length > 0) {
    const upserted = [];
    for (const pkg of wingetResults) {
      try {
        const app = await prisma.app.upsert({
          where: { wingetId: pkg.Id },
          update: { latestVersion: pkg.Latest.Version },
          create: {
            wingetId: pkg.Id,
            name: pkg.Name,
            publisher: pkg.Publisher,
            latestVersion: pkg.Latest.Version,
            description: pkg.Description,
            status: "pending",
          },
        });
        upserted.push(app);
      } catch {}
    }

    const dbIds = new Set(apps.map((a) => a.wingetId));
    const merged = [
      ...apps,
      ...upserted.filter((a) => !dbIds.has(a.wingetId)),
    ];

    res.json({
      data: merged,
      total: merged.length,
      page: 1,
      pageSize: size,
      totalPages: 1,
    });
    return;
  }

  res.json({
    data: apps,
    total,
    page: pageNum,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  });
});

router.get("/categories", requireAuth, async (_req, res) => {
  const cats = await prisma.app.groupBy({
    by: ["category"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  res.json(cats.map((c) => ({ name: c.category, count: c._count.id })));
});

router.get("/:id", requireAuth, async (req, res) => {
  const app = await prisma.app.findUnique({
    where: { id: req.params.id },
    include: {
      packages: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { tenant: { select: { id: true, displayName: true } } },
      },
      _count: { select: { packages: true, patchFlows: true } },
    },
  });

  if (!app) {
    res.status(404).json({ code: "NOT_FOUND", message: "App not found" });
    return;
  }

  res.json(app);
});

router.post(
  "/:id/build-package",
  requireAuth,
  requirePermission("PACKAGE_BUILD"),
  async (req, res) => {
    const { tenantId, installCmd, uninstallCmd, detectionMethod } = req.body;

    if (!tenantId) {
      res.status(400).json({ code: "MISSING_TENANT", message: "tenantId is required" });
      return;
    }

    const app = await prisma.app.findUnique({ where: { id: req.params.id } });
    if (!app) {
      res.status(404).json({ code: "NOT_FOUND", message: "App not found" });
      return;
    }

    const pkg = await prisma.package.create({
      data: {
        appId: app.id,
        tenantId,
        version: app.latestVersion,
        installCmd: installCmd || `${app.name.replace(/\s/g, "")}_setup.exe /S /quiet`,
        uninstallCmd: uninstallCmd || `${app.name.replace(/\s/g, "")}_setup.exe /S /uninstall`,
        detectionMethod: detectionMethod || `Registry: HKLM\\SOFTWARE\\${app.publisher}\\${app.name}`,
        validationStatus: "pending",
      },
    });

    const job = await enqueuePackagingJob({
      packageId: pkg.id,
      appId: app.id,
      tenantId,
      version: app.latestVersion,
      installCmd: pkg.installCmd!,
      uninstallCmd: pkg.uninstallCmd!,
      appName: app.name,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: "PACKAGE_BUILD_QUEUED",
        resourceType: "Package",
        resourceId: pkg.id,
        details: { appName: app.name, version: app.latestVersion },
      },
    });

    res.status(201).json({ packageId: pkg.id, jobId: job.id });
  }
);

export default router;
