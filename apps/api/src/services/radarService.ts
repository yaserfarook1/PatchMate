import { getSocketServer } from "../lib/socket.js";
import { prisma } from "@autopack/database";
import { getDetectedApps } from "./graphService.js";

export async function runRadarScan(tenantId: string): Promise<void> {
  const io = getSocketServer();
  const room = `radar:${tenantId}`;

  let apps;
  try {
    apps = await getDetectedApps(tenantId);
  } catch (err) {
    io.to(room).emit("radar:scan-error", {
      tenantId,
      error: (err as Error).message,
    });
    throw err;
  }

  const total = apps.length;

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];

    const safeId = app.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);

    await prisma.deviceDiscovery.upsert({
      where: { id: `disc_${tenantId}_${safeId}` },
      update: {
        installedVersion: app.version ?? "Unknown",
        deviceCount: app.deviceCount,
        publisher: app.publisher ?? "Unknown",
        lastScanned: new Date(),
      },
      create: {
        id: `disc_${tenantId}_${safeId}`,
        tenantId,
        appName: app.displayName,
        publisher: app.publisher ?? "Unknown",
        installedVersion: app.version ?? "Unknown",
        deviceCount: app.deviceCount,
        lastScanned: new Date(),
      },
    });

    io.to(room).emit("radar:scan-progress", {
      tenantId,
      scanned: i + 1,
      total,
      currentApp: app.displayName,
    });
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { lastSyncAt: new Date() },
  });

  io.to(room).emit("radar:scan-complete", { tenantId, total });
}
