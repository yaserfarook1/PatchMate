import axios from "axios";
import { prisma } from "@autopack/database";
import { getSocketServer } from "../lib/socket.js";

const GRAPH_BETA = "https://graph.microsoft.com/beta";

export interface DeviceInstallState {
  deviceName: string;
  userName: string;
  installState: "installed" | "failed" | "notInstalled" | "uninstallFailed" | "pendingInstall" | "unknown";
  errorCode: string;
  lastSyncDateTime: string;
}

export interface WaveInstallSummary {
  intuneAppId: string;
  waveId: string;
  jobId: string;
  total: number;
  installed: number;
  failed: number;
  pending: number;
  unknown: number;
  percentComplete: number;
  devices: DeviceInstallState[];
}

// ── Poll device install states and stream progress ───────────────────────────

export async function trackDeploymentProgress(
  tenantId: string,
  intuneAppId: string,
  jobId: string,
  waveId: string,
  groupId: string,
  maxPollMinutes = 60
): Promise<void> {
  const io = getSocketServer();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.accessToken) return;

  const headers = { Authorization: `Bearer ${tenant.accessToken}` };
  const deadline = Date.now() + maxPollMinutes * 60 * 1000;
  const pollInterval = 30_000; // poll every 30s

  const emit = (summary: WaveInstallSummary) =>
    io.emit("deployment:device-progress", summary);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    try {
      // Get device install states for this app
      const { data } = await axios.get(
        `${GRAPH_BETA}/deviceAppManagement/mobileApps/${intuneAppId}/deviceStatuses?$top=100`,
        { headers }
      );

      const states: any[] = data.value ?? [];

      const summary: WaveInstallSummary = {
        intuneAppId,
        waveId,
        jobId,
        total: states.length,
        installed: states.filter((s) => s.installState === "installed").length,
        failed: states.filter((s) => s.installState === "failed" || s.installState === "uninstallFailed").length,
        pending: states.filter((s) => ["notInstalled", "pendingInstall"].includes(s.installState)).length,
        unknown: states.filter((s) => s.installState === "unknown").length,
        percentComplete:
          states.length > 0
            ? Math.round((states.filter((s) => s.installState === "installed").length / states.length) * 100)
            : 0,
        devices: states.slice(0, 20).map((s) => ({
          deviceName: s.deviceName ?? "Unknown",
          userName: s.userName ?? "",
          installState: s.installState,
          errorCode: s.errorCode ?? "",
          lastSyncDateTime: s.lastSyncDateTime ?? "",
        })),
      };

      emit(summary);

      // Update the deployment job with latest stats
      await prisma.deploymentJob.update({
        where: { id: jobId },
        data: {
          errorLog: summary.failed > 0
            ? `${summary.failed} device(s) failed installation`
            : null,
        },
      }).catch(() => { /* ignore if job already finalised */ });

      // Stop polling when all devices have a definitive state
      const definitive = summary.installed + summary.failed;
      if (summary.total > 0 && definitive >= summary.total) {
        console.log(`[Tracking] Deployment ${jobId} complete: ${summary.installed}/${summary.total} installed`);
        break;
      }
    } catch (err: any) {
      console.warn(`[Tracking] Poll error for job ${jobId}:`, err.message);
      // Don't break — transient errors are common; keep polling
    }
  }
}
