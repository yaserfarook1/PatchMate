import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

export interface PackagingJobData {
  packageId: string;
  appId: string;
  tenantId: string;
  version: string;
  installCmd: string;
  uninstallCmd: string;
  appName: string;
}

export const packagingQueue = new Queue<PackagingJobData>("packaging", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export async function enqueuePackagingJob(data: PackagingJobData) {
  return packagingQueue.add(`package-${data.packageId}`, data, {
    jobId: `pkg-${data.packageId}`,
  });
}
