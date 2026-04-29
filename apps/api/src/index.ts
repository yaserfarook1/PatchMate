import { createServer } from "http";
import { createApp } from "./app.js";
import { initSocketServer } from "./lib/socket.js";
import { startPackagingWorker } from "./workers/packagingWorker.js";
import { startWaveWorker } from "./workers/waveScheduler.js";
import { startVersionMonitorWorker, scheduleVersionMonitorJob } from "./workers/versionMonitorWorker.js";
import { startInstantAppSyncWorker, scheduleInstantAppSync } from "./workers/instantAppSyncWorker.js";
import { config } from "./config.js";

const app = createApp();
const httpServer = createServer(app);

initSocketServer(httpServer);
startPackagingWorker();
startWaveWorker();
startVersionMonitorWorker();
scheduleVersionMonitorJob().catch((err: Error) =>
  console.warn("[VersionMonitor] Schedule setup failed:", err.message)
);
startInstantAppSyncWorker();
scheduleInstantAppSync().catch((err: Error) =>
  console.warn("[InstantAppSync] Schedule setup failed:", err.message)
);

httpServer.listen(config.PORT, () => {
  console.log(`\n🚀 AutoPack API running at http://localhost:${config.PORT}`);
  console.log(`   Environment: ${config.NODE_ENV}`);
  console.log(`   Mock Auth: ${config.MOCK_AUTH ? "enabled" : "disabled"}`);
  console.log(`   Frontend: ${config.FRONTEND_URL}\n`);
});

httpServer.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

function shutdown() {
  // Force-close all keep-alive connections so the port is released immediately.
  // Without this, httpServer.close() waits indefinitely for idle connections,
  // which causes EADDRINUSE when tsx watch restarts the process.
  (httpServer as any).closeAllConnections?.();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
