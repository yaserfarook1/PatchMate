import { Worker, Queue, Job } from "bullmq";
import axios from "axios";
import { redis } from "../lib/redis.js";
import { prisma } from "@autopack/database";

const QUEUE_NAME = "instant-app-sync";
const INDEX_URL = "https://raw.githubusercontent.com/svrooij/winget-pkgs-index/main/index.v2.json";

interface IndexEntry {
  Name: string;
  PackageId: string;
  Version: string;
  Tags?: string[];
  LastUpdate?: string;
}

export const instantAppSyncQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 10 },
});

export async function scheduleInstantAppSync(): Promise<void> {
  const existing = await instantAppSyncQueue.getRepeatableJobs();
  for (const job of existing) {
    await instantAppSyncQueue.removeRepeatableByKey(job.key);
  }

  await instantAppSyncQueue.add("sync", {}, {
    repeat: { pattern: "0 */4 * * *" }, // every 4 hours
    jobId: "instant-app-sync",
  });

  // Trigger initial sync immediately if DB is empty
  const count = await prisma.instantApp.count();
  if (count === 0) {
    await instantAppSyncQueue.add("initial-sync", {}, { jobId: "initial-sync" });
  }

  console.log(`[InstantAppSync] Scheduled every 4 hours (${count} apps in DB)`);
}

export function startInstantAppSyncWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      console.log("[InstantAppSync] Downloading Winget package index...");

      const { data: entries } = await axios.get<IndexEntry[]>(INDEX_URL, {
        timeout: 120_000,
      });

      console.log(`[InstantAppSync] Downloaded ${entries.length} entries — syncing to DB...`);

      let created = 0;
      let updated = 0;
      const batchSize = 500;

      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (entry) => {
            try {
              const [publisher, ...rest] = entry.PackageId.split(".");
              const publisherName = entry.Name ? undefined : publisher;

              const result = await prisma.instantApp.upsert({
                where: { wingetId: entry.PackageId },
                update: {
                  name: entry.Name || entry.PackageId,
                  latestVersion: entry.Version,
                  tags: entry.Tags ?? [],
                  lastUpdate: entry.LastUpdate ? new Date(entry.LastUpdate) : null,
                },
                create: {
                  wingetId: entry.PackageId,
                  name: entry.Name || entry.PackageId,
                  publisher: publisherName ?? publisher,
                  latestVersion: entry.Version,
                  tags: entry.Tags ?? [],
                  lastUpdate: entry.LastUpdate ? new Date(entry.LastUpdate) : null,
                },
              });

              if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
              else updated++;
            } catch {
              // skip individual entry errors
            }
          })
        );

        if (i % 2000 === 0 && i > 0) {
          console.log(`[InstantAppSync] Progress: ${i}/${entries.length}`);
        }
      }

      console.log(
        `[InstantAppSync] Complete — ${entries.length} total, ${created} new, ${updated} updated`
      );
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on("failed", (job, err) =>
    console.error("[InstantAppSync] Failed:", err.message)
  );

  return worker;
}
