import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { prisma } from "@autopack/database";
import { getSocketServer } from "../lib/socket.js";
import { PackagingJobData } from "./packagingQueue.js";
import { downloadInstaller, inferInstallCmd } from "../services/wingetDownloadService.js";
import { detectInstallerFramework, type InstallerFramework } from "../services/installerDetectionService.js";
import { generateDetectionScript, writeDetectionScript } from "../services/detectionScriptService.js";
import { generateDeployApplicationPs1, writePsadtScript } from "../services/psadtGeneratorService.js";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { config } from "../config.js";

export function startPackagingWorker() {
  const worker = new Worker<PackagingJobData>(
    "packaging",
    async (job: Job<PackagingJobData>) => {
      const io = getSocketServer();
      const { packageId, appId, version, appName } = job.data;
      const room = `job:${packageId}`;

      const log = (percent: number, line: string) =>
        io.to(room).emit("job:progress", {
          jobId: job.id,
          packageId,
          percent,
          logLine: line,
          timestamp: new Date().toISOString(),
        });

      await prisma.package.update({
        where: { id: packageId },
        data: { validationStatus: "running" },
      });

      log(2, `[AutoPack] Starting build for ${appName} v${version}`);

      // ── Resolve app metadata ──────────────────────────────────────────────
      const app = await prisma.app.findUnique({ where: { id: appId } });
      const wingetId = app?.wingetId ?? "";
      const isIntuneApp = wingetId.startsWith("Intune.");
      const isCustomApp = wingetId.startsWith("Custom.") || wingetId.startsWith("Managed.");

      log(8, `[AutoPack] App source: ${
        isIntuneApp  ? "Intune (existing managed app)" :
        isCustomApp  ? "Custom upload"                 :
        `Winget catalog (${wingetId})`
      }`);

      // ── Resolve installer source ──────────────────────────────────────────
      let realInstallerPath: string | null = null;
      let detectedInstallCmd: string | undefined;
      let detectedUninstallCmd: string | undefined;
      let detectedDetectionMethod: string | undefined;
      let detectionScriptPath: string | undefined;
      let psadtScriptPath: string | undefined;
      let detectedFramework: InstallerFramework = "Unknown";
      let detectedSilentSwitch = "/S";
      let detectedProductCode: string | undefined;

      // Check if the user already uploaded a file for this package
      const existingPkg = await prisma.package.findUnique({ where: { id: packageId } });
      const hasUploadedFile = !!(existingPkg?.installerPath && fs.existsSync(existingPkg.installerPath));

      if (hasUploadedFile) {
        // ── Path A: User uploaded a real installer file ──────────────────────
        realInstallerPath = existingPkg!.installerPath!;
        log(55, `[AutoPack] Using uploaded installer: ${path.basename(realInstallerPath)} (${(fs.statSync(realInstallerPath).size / 1024 / 1024).toFixed(1)} MB)`);

      } else if (isIntuneApp) {
        // ── Path B: App already managed by Intune — no upload needed ─────────
        log(55, `[AutoPack] App exists in Intune — package will reference existing Intune app`);
        log(55, `[AutoPack] Deployment will assign directly without uploading a new binary`);

      } else if (!isCustomApp && wingetId.includes(".")) {
        // ── Path C: Winget catalog app — download real installer ──────────────
        log(12, `[Winget] Searching for installer: ${wingetId} v${version}`);

        const result = await downloadInstaller(
          wingetId,
          version,
          (pct, msg) => log(12 + Math.round(pct * 0.45), `[Winget] ${msg}`)
        );

        if (result) {
          realInstallerPath = result.filePath;
          const sizeMb = (fs.statSync(realInstallerPath).size / 1024 / 1024).toFixed(1);
          log(58, `[AutoPack] Installer downloaded: ${path.basename(realInstallerPath)} (${sizeMb} MB)`);

          const inferred = inferInstallCmd(
            appName, result.installerType, result.silentSwitch, path.basename(result.filePath)
          );
          detectedInstallCmd      = job.data.installCmd      || inferred.installCmd;
          detectedUninstallCmd    = job.data.uninstallCmd    || inferred.uninstallCmd;
          detectedDetectionMethod = inferred.detectionMethod;

          log(60, `[AutoPack] Install:   ${detectedInstallCmd}`);
          log(60, `[AutoPack] Uninstall: ${detectedUninstallCmd}`);
          log(60, `[AutoPack] Detection: ${detectedDetectionMethod}`);
        } else {
          // No installer on Winget — fail clearly
          const failLog = [
            `Could not find an installer for "${appName}" (${wingetId}) on Winget.`,
            ``,
            `To fix this, use one of the following options:`,
            `  1. Go to Packages → Upload and provide the installer file (.exe/.msi/.msix)`,
            `  2. Search the Winget catalog for a different package ID for this app`,
          ].join("\n");

          await failBuild(packageId, appId, failLog, room, job.id!, io);
          return;
        }

      } else {
        // ── Path D: Discovered / Custom app with no uploaded file ─────────────
        const failLog = [
          `"${appName}" was discovered on your devices but has no installer file attached.`,
          ``,
          `To package this app, choose one of the following:`,
          `  1. Go to Packages → Upload App and provide the ${appName} installer (.exe / .msi)`,
          `  2. Search "${appName}" in the Winget Catalog — if it exists there, build from that listing instead`,
        ].join("\n");

        await failBuild(packageId, appId, failLog, room, job.id!, io);
        return;
      }

      // ── Installer framework detection ─────────────────────────────────────
      if (realInstallerPath && !isIntuneApp) {
        log(59, `[AutoPack] Detecting installer framework...`);
        const detection = detectInstallerFramework(realInstallerPath);
        detectedFramework     = detection.framework;
        detectedSilentSwitch  = detection.silentSwitch;
        detectedProductCode   = detection.msiProductCode;

        log(60, `[AutoPack] Framework: ${detection.framework} | Silent switch: "${detection.silentSwitch}"`);

        if (detection.msiProductCode) {
          log(60, `[AutoPack] MSI ProductCode: ${detection.msiProductCode}`);
          detectedDetectionMethod = `MSI: ${detection.msiProductCode}`;
        }

        // Prefer binary-detected switch over Winget manifest if more specific
        if (detection.silentSwitch && detection.silentSwitch !== "/S") {
          const base = path.basename(realInstallerPath);
          detectedInstallCmd   = `"${base}" ${detection.silentSwitch}`;
          detectedUninstallCmd = `"${base}" /uninstall ${detection.silentSwitch}`;
        }

        // Generate version-aware PowerShell detection script
        log(61, `[AutoPack] Generating version-aware detection script (>= v${version})...`);
        const scriptContent = generateDetectionScript({
          packageId, appName, version,
          framework: detection.framework,
          msiProductCode: detection.msiProductCode,
        });
        detectionScriptPath = writeDetectionScript(packageId, scriptContent);
        log(61, `[AutoPack] Detection script: checks installed version >= ${version}`);

        // Generate PSADT wrapper script
        const customSettings = await prisma.customAppSetting.findFirst({
          where: { appId, tenantId: job.data.tenantId },
        });
        log(62, `[AutoPack] Generating PSADT v3 wrapper script...`);
        const psadtContent = generateDeployApplicationPs1({
          packageId,
          appName,
          appVersion: version,
          publisher: app?.publisher ?? "Unknown",
          installerFileName: path.basename(realInstallerPath),
          framework: detection.framework,
          silentSwitch: detection.silentSwitch,
          msiProductCode: detection.msiProductCode,
          uninstallCmd: detectedUninstallCmd ?? job.data.uninstallCmd ?? "",
          preScript:  customSettings?.preScript  ?? null,
          postScript: customSettings?.postScript ?? null,
          registryValues: customSettings?.registryValues as Record<string, { name: string; value: string; type?: string }> | null,
        });
        psadtScriptPath = writePsadtScript(packageId, psadtContent);

        // PSADT install/uninstall commands (override the plain binary commands)
        const psadtFlag = `-ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -File Deploy-Application.ps1`;
        detectedInstallCmd   = `powershell.exe ${psadtFlag} -DeploymentType Install -DeployMode Silent`;
        detectedUninstallCmd = `powershell.exe ${psadtFlag} -DeploymentType Uninstall -DeployMode Silent`;
        log(62, `[AutoPack] PSADT wrapper ready — install via Deploy-Application.ps1`);
      }

      // ── Build the .intunewin package ──────────────────────────────────────
      log(62, `[AutoPack] Creating IntuneWin package...`);
      await job.updateProgress(62);

      let filePath: string;
      let fileSize: number;

      try {
        if (realInstallerPath && !isIntuneApp) {
          const result = await buildIntuneWin(
            packageId, appId, version, realInstallerPath,
            detectedInstallCmd ?? job.data.installCmd,
            detectedUninstallCmd ?? job.data.uninstallCmd,
            psadtScriptPath
          );
          filePath = result.filePath;
          fileSize = result.fileSize;
        } else {
          // Intune app — create a reference manifest (no binary upload needed at deploy time)
          const result = await buildReferenceManifest(packageId, appId, version, wingetId, job.data);
          filePath = result.filePath;
          fileSize = result.fileSize;
        }
      } catch (err: any) {
        await prisma.package.update({
          where: { id: packageId },
          data: { validationStatus: "failed", validationLog: `Package creation failed: ${err.message}` },
        });
        await prisma.app.update({ where: { id: appId }, data: { status: "failed" } });
        io.to(room).emit("job:failed", {
          jobId: job.id, packageId,
          error: `Package creation failed: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const sizeKb = Math.round(fileSize / 1024);
      log(85, `[AutoPack] Package created: ${path.basename(filePath)} (${sizeKb} KB)`);

      // ── Update commands + detection on the package ────────────────────────
      await prisma.package.update({
        where: { id: packageId },
        data: {
          ...(detectedInstallCmd    && { installCmd:       detectedInstallCmd }),
          ...(detectedUninstallCmd  && { uninstallCmd:     detectedUninstallCmd }),
          ...(detectedDetectionMethod && { detectionMethod: detectedDetectionMethod }),
        },
      });

      // ── Mark ready ────────────────────────────────────────────────────────
      const buildLog = [
        `App:          ${appName} v${version}`,
        `Source:       ${isIntuneApp ? "Existing Intune app" : realInstallerPath ? "Real installer from Winget" : "Custom upload"}`,
        `Package file: ${path.basename(filePath)} (${sizeKb} KB)`,
        isIntuneApp
          ? "Deployment:   Will assign existing Intune app to target group — no file upload"
          : "Deployment:   Will upload encrypted package to Intune + assign to target group",
        detectedInstallCmd    ? `Install cmd:  ${detectedInstallCmd}`   : "",
        detectedUninstallCmd  ? `Uninstall:    ${detectedUninstallCmd}` : "",
        detectedDetectionMethod ? `Detection:  ${detectedDetectionMethod}` : "",
        "",
        "[AutoPack] Package ready to deploy ✓",
      ].filter(Boolean).join("\n");

      await prisma.package.update({
        where: { id: packageId },
        data: {
          validationStatus: "passed",
          intuneWinPath: filePath,                               // outer zip (Download button)
          installerPath: realInstallerPath ?? undefined,         // raw binary (Intune upload)
          detectionScriptPath: detectionScriptPath ?? undefined, // PS1 script (set in Fix 4)
          fileSize,
          validationLog: buildLog,
        },
      });

      await prisma.app.update({ where: { id: appId }, data: { status: "validated", latestVersion: version } });
      await job.updateProgress(100);

      log(100, `[AutoPack] Package ready to deploy ✓`);

      io.to(room).emit("job:complete", {
        jobId: job.id, packageId,
        intuneWinPath: filePath,
        fileSize,
        realInstaller: !!realInstallerPath && !isIntuneApp,
        timestamp: new Date().toISOString(),
      });

      await prisma.auditLog.create({
        data: {
          userId: "user_admin_seed",
          action: "PACKAGE_BUILT",
          resourceType: "Package",
          resourceId: packageId,
          details: { appName, version, realInstaller: !!realInstallerPath && !isIntuneApp },
        },
      });
    },
    { connection: redis, concurrency: 3 }
  );

  worker.on("failed", (job, err) => console.error(`[Worker] Job ${job?.id} failed:`, err.message));
  worker.on("completed", (job) => console.log(`[Worker] Job ${job.id} completed`));

  return worker;
}

// ── Shared fail helper ────────────────────────────────────────────────────────

async function failBuild(
  packageId: string,
  appId: string,
  message: string,
  room: string,
  jobId: string,
  io: ReturnType<typeof import("../lib/socket.js")["getSocketServer"]>
) {
  await prisma.package.update({
    where: { id: packageId },
    data: { validationStatus: "failed", validationLog: message },
  });

  const anyPassed = await prisma.package.findFirst({ where: { appId, validationStatus: "passed" } });
  if (!anyPassed) {
    await prisma.app.update({ where: { id: appId }, data: { status: "failed" } });
  }

  io.to(room).emit("job:failed", {
    jobId,
    packageId,
    error: message.split("\n")[0], // first line as toast text
    timestamp: new Date().toISOString(),
  });
}

// ── Wrap a real installer in IntuneWin zip ────────────────────────────────────

async function buildIntuneWin(
  packageId: string,
  appId: string,
  version: string,
  installerPath: string,
  installCmd?: string,
  uninstallCmd?: string,
  psadtScriptPath?: string
): Promise<{ filePath: string; fileSize: number }> {
  const dir = path.resolve(config.UPLOADS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${packageId}.intunewin`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 6 } });
    output.on("close", () => resolve({ filePath: outPath, fileSize: archive.pointer() }));
    archive.on("error", reject);
    archive.pipe(output);

    if (psadtScriptPath && fs.existsSync(psadtScriptPath)) {
      // PSADT structure: Deploy-Application.ps1 at root + installer in Files/
      archive.file(psadtScriptPath, { name: "Deploy-Application.ps1" });
      archive.file(installerPath,   { name: `Files/${path.basename(installerPath)}` });

      // Bundle PSADT runtime if present alongside the API executable
      const toolkitDir = path.resolve(__dirname, "../../../AppDeployToolkit");
      if (fs.existsSync(toolkitDir)) {
        archive.directory(toolkitDir, "AppDeployToolkit");
      }
    } else {
      // Flat fallback: installer at root + metadata
      archive.file(installerPath, { name: path.basename(installerPath) });
      archive.append(JSON.stringify({
        PackageId: packageId, AppId: appId, Version: version,
        SetupFile: path.basename(installerPath),
        InstallCommand: installCmd, UninstallCommand: uninstallCmd,
        CreatedAt: new Date().toISOString(),
        Format: "intunewin-autopack",
      }, null, 2), { name: "IntuneWinPackage/metadata/Detection.xml" });
    }

    archive.finalize();
  });
}

// ── Reference manifest for apps already in Intune (no binary needed) ─────────

async function buildReferenceManifest(
  packageId: string,
  appId: string,
  version: string,
  wingetId: string,
  meta: object
): Promise<{ filePath: string; fileSize: number }> {
  const dir = path.resolve(config.UPLOADS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${packageId}.intunewin`);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve({ filePath: outPath, fileSize: archive.pointer() }));
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(JSON.stringify({
      type: "intune-reference",
      packageId,
      appId,
      version,
      intuneAppId: wingetId.replace("Intune.", ""),
      note: "This package references an existing Intune app. No installer upload is required on deployment.",
      createdAt: new Date().toISOString(),
      ...meta,
    }, null, 2), { name: "reference.json" });

    archive.finalize();
  });
}
