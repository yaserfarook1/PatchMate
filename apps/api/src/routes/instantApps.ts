import { Router } from "express";
import axios from "axios";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { getSocketServer } from "../lib/socket.js";
import { downloadInstaller } from "../services/wingetDownloadService.js";
import { detectInstallerFramework } from "../services/installerDetectionService.js";
import { config } from "../config.js";

const router = Router();

const GITHUB_RAW = "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests";
const GITHUB_API = "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests";

// ── Search instant apps catalog ───────────────────────────────────────────────

router.get("/", requireAuth, async (req, res) => {
  const { search = "", page = "1", pageSize = "24", tag } = req.query as Record<string, string>;
  const pageNum = parseInt(page);
  const size = parseInt(pageSize);
  const skip = (pageNum - 1) * size;

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { publisher: { contains: search, mode: "insensitive" } },
      { wingetId: { contains: search, mode: "insensitive" } },
    ];
  }
  if (tag) {
    where.tags = { has: tag };
  }

  const [apps, total] = await Promise.all([
    prisma.instantApp.findMany({
      where,
      skip,
      take: size,
      orderBy: search ? { name: "asc" } : { lastUpdate: "desc" },
    }),
    prisma.instantApp.count({ where }),
  ]);

  res.json({
    data: apps,
    total,
    page: pageNum,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  });
});

// ── Popular tags ──────────────────────────────────────────────────────────────

router.get("/tags", requireAuth, async (_req, res) => {
  // Get top 20 most common tags
  const result = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT unnest(tags) as tag, COUNT(*) as count
    FROM instant_apps
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 20
  `;
  res.json(result.map((r) => ({ tag: r.tag, count: Number(r.count) })));
});

// ── Single app with version history from GitHub ───────────────────────────────

router.get("/:wingetId(*)", requireAuth, async (req, res) => {
  // Handle wingetIds with dots (e.g. Google.Chrome) — Express route param captures it
  const wingetId = req.params.wingetId || req.params[0];

  const app = await prisma.instantApp.findUnique({ where: { wingetId } });
  if (!app) {
    res.status(404).json({ code: "NOT_FOUND", message: "App not found in catalog" });
    return;
  }

  // Fetch all versions from GitHub (on-demand, not stored in DB)
  let versions: { version: string; date?: string }[] = [];
  try {
    const [publisher, ...rest] = wingetId.split(".");
    const packageName = rest.join(".");
    const prefix = publisher[0].toLowerCase();

    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (config.GITHUB_TOKEN) headers["Authorization"] = `token ${config.GITHUB_TOKEN}`;

    const { data: dirs } = await axios.get(
      `${GITHUB_API}/${prefix}/${publisher}/${packageName}`,
      { timeout: 10_000, headers }
    );

    versions = (dirs as any[])
      .filter((d: any) => d.type === "dir" && /^\d/.test(d.name))
      .map((d: any) => ({ version: d.name }))
      .sort((a, b) => {
        const pa = a.version.split(".").map(Number);
        const pb = b.version.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
  } catch {
    // Fallback: just return the latest version from the index
    versions = [{ version: app.latestVersion }];
  }

  res.json({ ...app, versions });
});

// ── Deploy a specific version ─────────────────────────────────────────────────

router.post("/deploy", requireAuth, requirePermission("PACKAGE_BUILD"), async (req, res) => {
  const { wingetId, version, tenantId, groupId } = req.body;

  if (!wingetId || !version || !tenantId) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "wingetId, version, tenantId required" });
    return;
  }

  const app = await prisma.instantApp.findUnique({ where: { wingetId } });
  if (!app) {
    res.status(404).json({ code: "NOT_FOUND", message: "App not found" });
    return;
  }

  // Create an App record in our workspace catalog (if not already there)
  const workspaceApp = await prisma.app.upsert({
    where: { wingetId },
    update: { latestVersion: version },
    create: {
      wingetId,
      name: app.name,
      publisher: app.publisher,
      latestVersion: version,
      status: "pending",
      category: "Instant",
    },
  });

  // Create a Package record
  const pkg = await prisma.package.create({
    data: {
      appId: workspaceApp.id,
      tenantId,
      version,
      validationStatus: "pending",
    },
  });

  const jobId = `instant-${pkg.id}`;

  // Respond immediately
  res.status(201).json({ packageId: pkg.id, jobId, appName: app.name, version });

  // Run the full pipeline asynchronously
  const io = getSocketServer();
  const emit = (step: string, percent: number) =>
    io.emit("instant-deploy:progress", { jobId, step, percent });

  (async () => {
    try {
      await prisma.package.update({ where: { id: pkg.id }, data: { validationStatus: "running" } });

      // 1. Download installer
      emit("Downloading installer from Winget...", 10);
      const result = await downloadInstaller(wingetId, version, (pct, msg) =>
        emit(msg, 10 + Math.round(pct * 0.3))
      );

      if (!result) {
        throw new Error(`No installer found for ${wingetId} v${version}`);
      }

      // 2. Detect framework
      emit("Detecting installer framework...", 42);
      const detection = detectInstallerFramework(result.filePath);
      emit(`Framework: ${detection.framework}`, 45);

      // 3. Create IntuneWin package via Microsoft tool
      emit("Creating .intunewin package (IntuneWinAppUtil)...", 48);
      const { createIntuneWinPackage } = await import("../services/intunePackageService.js");
      const outputDir = require("path").resolve(config.UPLOADS_DIR, "intunewin_output");
      const intuneResult = await createIntuneWinPackage(result.filePath, outputDir);

      // 4. Update package record
      await prisma.package.update({
        where: { id: pkg.id },
        data: {
          installerPath: result.filePath,
          validationStatus: "passed",
          installCmd: detection.framework === "MSI"
            ? `msiexec /i "${require("path").basename(result.filePath)}" /qn /norestart`
            : `"${require("path").basename(result.filePath)}" ${detection.silentSwitch}`,
          detectionMethod: detection.msiProductCode
            ? `MSI: ${detection.msiProductCode}`
            : `Registry: HKLM\\SOFTWARE\\${app.name}`,
          fileSize: intuneResult.encryptedSize,
        },
      });

      await prisma.app.update({
        where: { id: workspaceApp.id },
        data: { status: "validated", latestVersion: version },
      });

      emit("Package ready!", 55);

      // 5. Deploy to Intune (if groupId provided)
      if (groupId) {
        emit("Uploading to Intune...", 58);

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant?.accessToken) throw new Error("Tenant not connected");

        const { deployPackageToWave } = await import("../services/intuneDeployService.js");

        await deployPackageToWave(pkg.id, groupId, tenantId, ({ step, percent }) =>
          emit(step, 58 + Math.round(percent * 0.4))
        );

        emit("Deployed to Intune! 🚀", 100);
      } else {
        emit("Package built — ready to deploy from Patch Flows", 100);
      }

      io.emit("instant-deploy:complete", { jobId, packageId: pkg.id });

    } catch (err: any) {
      console.error(`[InstantDeploy] ${jobId} failed:`, err.message);
      await prisma.package.update({
        where: { id: pkg.id },
        data: { validationStatus: "failed", validationLog: err.message },
      }).catch(() => {});
      io.emit("instant-deploy:failed", { jobId, error: err.message });
    }
  })();
});

// ── Manual sync trigger ───────────────────────────────────────────────────────

router.post("/sync", requireAuth, requirePermission("TENANT_MANAGE"), async (_req, res) => {
  const { instantAppSyncQueue } = await import("../workers/instantAppSyncWorker.js");
  await instantAppSyncQueue.add("manual-sync", {}, { jobId: `manual-${Date.now()}` });
  res.json({ message: "Sync triggered" });
});

export default router;
