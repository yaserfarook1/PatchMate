import { Router } from "express";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getSocketServer } from "../lib/socket.js";
import { deployPackageToWave } from "../services/intuneDeployService.js";
import { trackDeploymentProgress } from "../services/deploymentTrackingService.js";
import { scheduleNextWave } from "../workers/waveScheduler.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { tenantId, page = "1", pageSize = "20" } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const size = parseInt(pageSize);

  const where: any = {};
  if (tenantId) where.tenantId = tenantId;

  const [flows, total] = await Promise.all([
    prisma.patchFlow.findMany({
      where,
      skip: (pageNum - 1) * size,
      take: size,
      orderBy: { createdAt: "desc" },
      include: {
        app: { select: { id: true, name: true, publisher: true, iconUrl: true } },
        waves: { orderBy: { order: "asc" } },
        _count: { select: { waves: true } },
      },
    }),
    prisma.patchFlow.count({ where }),
  ]);

  res.json({ data: flows, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) });
});

router.get("/:id", requireAuth, async (req, res) => {
  const flow = await prisma.patchFlow.findUnique({
    where: { id: req.params.id },
    include: {
      app: true,
      tenant: { select: { id: true, displayName: true } },
      waves: { orderBy: { order: "asc" }, include: { deploymentJobs: { orderBy: { createdAt: "desc" }, take: 5 } } },
    },
  });

  if (!flow) {
    res.status(404).json({ code: "NOT_FOUND", message: "Patch flow not found" });
    return;
  }
  res.json(flow);
});

router.post("/", requireAuth, requirePermission("FLOW_MANAGE"), async (req, res) => {
  const { appId, tenantId, name, autoUpdate, waves = [] } = req.body;

  if (!appId || !tenantId || !name) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "appId, tenantId, name are required" });
    return;
  }

  const flow = await prisma.patchFlow.create({
    data: {
      appId,
      tenantId,
      name,
      autoUpdate: autoUpdate ?? false,
      waves: {
        create: (waves as any[]).map((w: any, i: number) => ({
          name: w.name,
          groupId: w.groupId || `group_${i + 1}`,
          delayHours: w.delayHours || 0,
          order: w.order ?? i + 1,
        })),
      },
    },
    include: { waves: { orderBy: { order: "asc" } }, app: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      action: "FLOW_CREATED",
      resourceType: "PatchFlow",
      resourceId: flow.id,
      details: { name, waves: flow.waves.length },
    },
  });

  res.status(201).json(flow);
});

router.patch("/:id", requireAuth, requirePermission("FLOW_MANAGE"), async (req, res) => {
  const { name, autoUpdate, waves } = req.body;

  const existing = await prisma.patchFlow.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ code: "NOT_FOUND", message: "Flow not found" });
    return;
  }

  const updated = await prisma.patchFlow.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(autoUpdate !== undefined && { autoUpdate }),
    },
  });

  if (waves && Array.isArray(waves)) {
    await prisma.wave.deleteMany({ where: { flowId: req.params.id } });
    await prisma.wave.createMany({
      data: (waves as any[]).map((w: any, i: number) => ({
        flowId: req.params.id,
        name: w.name,
        groupId: w.groupId || `group_${i + 1}`,
        delayHours: w.delayHours || 0,
        order: w.order ?? i + 1,
        status: w.status || "pending",
      })),
    });
  }

  const result = await prisma.patchFlow.findUnique({
    where: { id: req.params.id },
    include: { waves: { orderBy: { order: "asc" } }, app: true },
  });

  res.json(result);
});

router.delete("/:id", requireAuth, requirePermission("FLOW_MANAGE"), async (req, res) => {
  const flow = await prisma.patchFlow.findUnique({ where: { id: req.params.id } });
  if (!flow) {
    res.status(404).json({ code: "NOT_FOUND", message: "Flow not found" });
    return;
  }

  await prisma.patchFlow.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

router.post("/:id/trigger-wave", requireAuth, requirePermission("DEPLOYMENT_TRIGGER"), async (req, res) => {
  const { waveId } = req.body;

  const flow = await prisma.patchFlow.findUnique({
    where: { id: req.params.id },
    include: { waves: true },
  });

  if (!flow) {
    res.status(404).json({ code: "NOT_FOUND", message: "Flow not found" });
    return;
  }

  const wave = flow.waves.find((w) => w.id === waveId);
  if (!wave) {
    res.status(404).json({ code: "NOT_FOUND", message: "Wave not found" });
    return;
  }

  // Find latest validated package — try exact appId first, then match by app name
  let latestPkg = await prisma.package.findFirst({
    where: { appId: flow.appId, tenantId: flow.tenantId, validationStatus: "passed" },
    orderBy: { createdAt: "desc" },
  });

  if (!latestPkg) {
    // Fallback: find by app name (handles Intune-synced vs Winget-built mismatch)
    const flowApp = await prisma.app.findUnique({ where: { id: flow.appId } });
    if (flowApp) {
      latestPkg = await prisma.package.findFirst({
        where: {
          tenantId: flow.tenantId,
          validationStatus: "passed",
          app: { name: { contains: flowApp.name, mode: "insensitive" } },
        },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  if (!latestPkg) {
    res.status(400).json({ code: "NO_PACKAGE", message: "No validated package found for this app. Build one from Instant Apps first." });
    return;
  }

  const job = await prisma.deploymentJob.create({
    data: {
      packageId: latestPkg.id,
      waveId: wave.id,
      status: "queued",
    },
  });

  await prisma.wave.update({ where: { id: wave.id }, data: { status: "active" } });

  const io = getSocketServer();

  const emit = (message: string, percent: number, status = "running") =>
    io.emit("deployment:progress", { jobId: job.id, waveId, status, message, percent });

  // Run asynchronously — respond immediately so UI can start listening
  (async () => {
    try {
      await prisma.deploymentJob.update({
        where: { id: job.id },
        data: { status: "running", startedAt: new Date() },
      });

      emit("Starting deployment...", 5);

      const { intuneAppId } = await deployPackageToWave(
        latestPkg.id,
        wave.groupId,
        flow.tenantId,
        ({ step, percent }) => emit(step, percent)
      );

      emit(`App assigned to group in Intune ✓ (${intuneAppId})`, 95);

      await prisma.deploymentJob.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date() },
      });
      await prisma.wave.update({ where: { id: wave.id }, data: { status: "completed" } });

      emit("Deployment complete! 🚀 Tracking device install progress...", 100, "completed");

      // Background: poll per-device install states
      trackDeploymentProgress(flow.tenantId, intuneAppId, job.id, wave.id, wave.groupId)
        .catch((err) => console.warn("[Tracking] Background tracking error:", err.message));

      // Schedule the next wave automatically (respects delayHours)
      scheduleNextWave(flow.id, wave.order, req.user!.id)
        .catch((err) => console.warn("[WaveScheduler] Schedule error:", err.message));

    } catch (err: any) {
      const msg = err.response?.data?.error?.message ?? err.message;
      console.error(`[Deploy] Job ${job.id} failed:`, msg);

      await prisma.deploymentJob.update({
        where: { id: job.id },
        data: { status: "failed", errorLog: msg, completedAt: new Date() },
      });
      await prisma.wave.update({ where: { id: wave.id }, data: { status: "failed" } });

      io.emit("deployment:progress", { jobId: job.id, waveId, status: "failed", message: `Deployment failed: ${msg}`, percent: 0 });
    }
  })();

  res.status(201).json({ jobId: job.id, waveId, status: "queued" });
});

export default router;
