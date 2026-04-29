import { Worker, Queue, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { prisma } from "@autopack/database";
import { getWingetPackage } from "../services/wingetService.js";
import { enqueuePackagingJob } from "./packagingQueue.js";

const QUEUE_NAME = "version-monitor";

export const versionMonitorQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 20 },
});

export async function scheduleVersionMonitorJob(): Promise<void> {
  // Clear any existing repeatable jobs first
  const existing = await versionMonitorQueue.getRepeatableJobs();
  for (const job of existing) {
    await versionMonitorQueue.removeRepeatableByKey(job.key);
  }

  await versionMonitorQueue.add(
    "daily-version-check",
    {},
    {
      repeat: { pattern: "0 3 * * *" }, // 03:00 every day
      jobId: "daily-version-check",
    }
  );

  console.log("[VersionMonitor] Daily version check scheduled at 03:00");
}

function isVersionNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v.split(/[.\-_]/).map((s) => parseInt(s.replace(/\D/g, "")) || 0);
  const cParts = parse(candidate);
  const curParts = parse(current);
  for (let i = 0; i < Math.max(cParts.length, curParts.length); i++) {
    const diff = (cParts[i] ?? 0) - (curParts[i] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export function startVersionMonitorWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      console.log("[VersionMonitor] Starting daily version check...");

      // Get all apps that belong to at least one auto-update flow
      const autoFlows = await prisma.patchFlow.findMany({
        where: { autoUpdate: true },
        include: { app: true },
        distinct: ["appId"],
      });

      // Resolve admin user for audit log (workers have no HTTP context)
      const adminUser = await prisma.user.findFirst({ where: { role: "Admin" } });
      const auditUserId = adminUser?.id ?? "user_admin_seed";

      const results = { checked: 0, updated: 0, triggered: 0, errors: 0 };

      for (const flow of autoFlows) {
        const app = flow.app;
        results.checked++;

        // Skip non-Winget apps — no manifest to check
        if (
          app.wingetId.startsWith("Custom.") ||
          app.wingetId.startsWith("Managed.") ||
          app.wingetId.startsWith("Intune.")
        ) {
          continue;
        }

        try {
          const wingetData = await getWingetPackage(app.wingetId);
          if (!wingetData) continue;

          const latestVersion = wingetData.Latest.Version;

          if (!isVersionNewer(latestVersion, app.latestVersion)) continue;

          console.log(
            `[VersionMonitor] ${app.name}: ${app.latestVersion} → ${latestVersion}`
          );

          // Update catalog record
          await prisma.app.update({
            where: { id: app.id },
            data: { latestVersion },
          });
          results.updated++;

          // Find all auto-update flows for this app and trigger a rebuild per tenant
          const affectedFlows = await prisma.patchFlow.findMany({
            where: { appId: app.id, autoUpdate: true },
            distinct: ["tenantId"],
          });

          for (const affFlow of affectedFlows) {
            const pkg = await prisma.package.create({
              data: {
                appId: app.id,
                tenantId: affFlow.tenantId,
                version: latestVersion,
                validationStatus: "pending",
              },
            });

            await enqueuePackagingJob({
              packageId: pkg.id,
              appId: app.id,
              tenantId: affFlow.tenantId,
              version: latestVersion,
              installCmd: "",
              uninstallCmd: "",
              appName: app.name,
            });

            results.triggered++;
          }

          await prisma.auditLog.create({
            data: {
              userId: auditUserId,
              action: "AUTO_UPDATE_TRIGGERED",
              resourceType: "App",
              resourceId: app.id,
              details: {
                appName: app.name,
                previousVersion: app.latestVersion,
                newVersion: latestVersion,
              },
            },
          });

        } catch (err: any) {
          console.warn(
            `[VersionMonitor] Error checking ${app.name}:`,
            err.message
          );
          results.errors++;
        }
      }

      console.log(
        `[VersionMonitor] Complete — checked: ${results.checked}, ` +
          `updated: ${results.updated}, triggered: ${results.triggered}, ` +
          `errors: ${results.errors}`
      );
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on("failed", (job, err) =>
    console.error("[VersionMonitor] Job failed:", err.message)
  );

  return worker;
}
