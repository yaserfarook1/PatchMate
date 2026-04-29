import { Queue, Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { prisma } from "@autopack/database";
import { getSocketServer } from "../lib/socket.js";
import { deployPackageToWave } from "../services/intuneDeployService.js";
import { trackDeploymentProgress } from "../services/deploymentTrackingService.js";

export interface WaveJobData {
  flowId: string;
  waveId: string;
  tenantId: string;
  packageId: string;
  triggeredByUserId: string;
}

export const waveQueue = new Queue<WaveJobData>("wave-deployment", {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

// Schedule the next wave in a flow after a delay
export async function scheduleNextWave(
  flowId: string,
  completedWaveOrder: number,
  triggeredByUserId: string
): Promise<void> {
  const flow = await prisma.patchFlow.findUnique({
    where: { id: flowId },
    include: { waves: { orderBy: { order: "asc" } } },
  });

  if (!flow) return;

  const nextWave = flow.waves.find((w) => w.order === completedWaveOrder + 1);
  if (!nextWave || nextWave.status === "completed") return;

  const latestPkg = await prisma.package.findFirst({
    where: { appId: flow.appId, tenantId: flow.tenantId, validationStatus: "passed" },
    orderBy: { createdAt: "desc" },
  });

  if (!latestPkg) return;

  const delayMs = nextWave.delayHours * 60 * 60 * 1000;

  const job = await waveQueue.add(
    `wave-${nextWave.id}`,
    {
      flowId,
      waveId: nextWave.id,
      tenantId: flow.tenantId,
      packageId: latestPkg.id,
      triggeredByUserId,
    },
    {
      jobId: `wave-${nextWave.id}-${Date.now()}`,
      delay: delayMs,
    }
  );

  console.log(
    `[WaveScheduler] Wave "${nextWave.name}" scheduled in ${nextWave.delayHours}h (job: ${job.id})`
  );

  await prisma.auditLog.create({
    data: {
      userId: triggeredByUserId,
      action: "WAVE_SCHEDULED",
      resourceType: "Wave",
      resourceId: nextWave.id,
      details: {
        waveName: nextWave.name,
        delayHours: nextWave.delayHours,
        scheduledAt: new Date().toISOString(),
        runsAt: new Date(Date.now() + delayMs).toISOString(),
      },
    },
  });
}

export function startWaveWorker() {
  const worker = new Worker<WaveJobData>(
    "wave-deployment",
    async (job: Job<WaveJobData>) => {
      const io = getSocketServer();
      const { flowId, waveId, tenantId, packageId, triggeredByUserId } = job.data;

      const wave = await prisma.wave.findUnique({ where: { id: waveId } });
      if (!wave) return;

      const dbJob = await prisma.deploymentJob.create({
        data: { packageId, waveId, status: "running", startedAt: new Date() },
      });

      await prisma.wave.update({ where: { id: waveId }, data: { status: "active" } });

      const emit = (message: string, percent: number, status = "running") =>
        io.emit("deployment:progress", { jobId: dbJob.id, waveId, status, message, percent });

      emit(`[Auto] Starting scheduled wave: ${wave.name}`, 5);

      try {
        const { intuneAppId } = await deployPackageToWave(
          packageId,
          wave.groupId,
          tenantId,
          ({ step, percent }) => emit(step, percent)
        );

        await prisma.deploymentJob.update({
          where: { id: dbJob.id },
          data: { status: "completed", completedAt: new Date() },
        });
        await prisma.wave.update({ where: { id: waveId }, data: { status: "completed" } });

        emit(`Wave "${wave.name}" complete! 🚀`, 100, "completed");

        // Start device tracking (background)
        trackDeploymentProgress(tenantId, intuneAppId, dbJob.id, waveId, wave.groupId).catch(() => {});

        // Schedule the next wave
        await scheduleNextWave(flowId, wave.order, triggeredByUserId);

      } catch (err: any) {
        await prisma.deploymentJob.update({
          where: { id: dbJob.id },
          data: { status: "failed", errorLog: err.message, completedAt: new Date() },
        });
        await prisma.wave.update({ where: { id: waveId }, data: { status: "failed" } });
        emit(`Wave "${wave.name}" failed: ${err.message}`, 0, "failed");
      }
    },
    { connection: redis, concurrency: 5 }
  );

  worker.on("failed", (job, err) =>
    console.error(`[WaveWorker] Job ${job?.id} failed:`, err.message)
  );

  return worker;
}
