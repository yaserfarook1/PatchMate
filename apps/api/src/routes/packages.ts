import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { config } from "../config.js";
import { enqueuePackagingJob } from "../workers/packagingQueue.js";

const router = Router();

const uploadsDir = path.resolve(config.UPLOADS_DIR);
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = [".exe", ".msi", ".msix", ".zip", ".appx"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

router.get("/", requireAuth, async (req, res) => {
  const { tenantId, page = "1", pageSize = "20", status } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const size = parseInt(pageSize);

  const where: any = {};
  if (tenantId) where.tenantId = tenantId;
  if (status) where.validationStatus = status;

  const [packages, total] = await Promise.all([
    prisma.package.findMany({
      where,
      skip: (pageNum - 1) * size,
      take: size,
      orderBy: { createdAt: "desc" },
      include: { app: { select: { id: true, name: true, publisher: true, iconUrl: true, category: true } }, tenant: { select: { id: true, displayName: true } } },
    }),
    prisma.package.count({ where }),
  ]);

  res.json({ data: packages, total, page: pageNum, pageSize: size, totalPages: Math.ceil(total / size) });
});

router.get("/:id", requireAuth, async (req, res) => {
  const pkg = await prisma.package.findUnique({
    where: { id: req.params.id },
    include: {
      app: true,
      tenant: { select: { id: true, displayName: true } },
      deploymentJobs: { orderBy: { createdAt: "desc" }, take: 10, include: { wave: true } },
    },
  });

  if (!pkg) {
    res.status(404).json({ code: "NOT_FOUND", message: "Package not found" });
    return;
  }
  res.json(pkg);
});

router.get("/:id/logs", requireAuth, async (req, res) => {
  const pkg = await prisma.package.findUnique({
    where: { id: req.params.id },
    select: { validationLog: true, validationStatus: true },
  });

  if (!pkg) {
    res.status(404).json({ code: "NOT_FOUND", message: "Package not found" });
    return;
  }

  res.setHeader("Content-Type", "text/plain");
  res.send(pkg.validationLog || `[AutoPack] Package status: ${pkg.validationStatus}\n[AutoPack] No logs available yet.`);
});

router.get("/:id/download", requireAuth, async (req, res) => {
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });

  if (!pkg || !pkg.intuneWinPath) {
    res.status(404).json({ code: "NOT_FOUND", message: "Package file not found" });
    return;
  }

  if (!fs.existsSync(pkg.intuneWinPath)) {
    res.status(404).json({ code: "FILE_MISSING", message: "Package file has been removed" });
    return;
  }

  res.download(pkg.intuneWinPath, `${pkg.id}.intunewin`);
});

router.post(
  "/upload",
  requireAuth,
  requirePermission("PACKAGE_BUILD"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ code: "NO_FILE", message: "No file uploaded" });
      return;
    }

    const { appName, publisher, version, tenantId, installCmd, uninstallCmd } = req.body;

    if (!appName || !version || !tenantId) {
      res.status(400).json({ code: "MISSING_FIELDS", message: "appName, version, tenantId are required" });
      return;
    }

    const wingetId = `Custom.${appName.replace(/\s+/g, "")}`;

    const app = await prisma.app.upsert({
      where: { wingetId },
      update: { latestVersion: version },
      create: {
        wingetId,
        name: appName,
        publisher: publisher || "Unknown",
        latestVersion: version,
        status: "pending",
        category: "Custom",
      },
    });

    const pkg = await prisma.package.create({
      data: {
        appId: app.id,
        tenantId,
        version,
        installCmd: installCmd || `${req.file.originalname} /S`,
        uninstallCmd: uninstallCmd || "",
        validationStatus: "pending",
        installerPath: req.file.path, // raw installer — used for Intune upload
        fileSize: req.file.size,
      },
    });

    const job = await enqueuePackagingJob({
      packageId: pkg.id,
      appId: app.id,
      tenantId,
      version,
      installCmd: pkg.installCmd!,
      uninstallCmd: pkg.uninstallCmd || "",
      appName,
    });

    res.status(201).json({ packageId: pkg.id, jobId: job.id, app });
  }
);

router.delete("/:id", requireAuth, requirePermission("PACKAGE_BUILD"), async (req, res) => {
  const pkg = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!pkg) {
    res.status(404).json({ code: "NOT_FOUND", message: "Package not found" });
    return;
  }

  if (pkg.intuneWinPath && fs.existsSync(pkg.intuneWinPath)) {
    fs.unlinkSync(pkg.intuneWinPath);
  }

  await prisma.package.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
