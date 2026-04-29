import axios from "axios";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { parse as parseYaml } from "yaml";
import { config } from "../config.js";

const WINGET_RUN   = "https://winget.run/api/v2/packages";
const GITHUB_RAW   = "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests";
const GITHUB_API   = "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests";

export interface InstallerInfo {
  url: string;
  sha256: string;
  type: "msi" | "exe" | "msix" | "zip";
  architecture: "x64" | "x86" | "neutral";
  scope?: "machine" | "user";
  switchSilent?: string;
}

// ── Installer preference helper ───────────────────────────────────────────────

function pickPreferred(installers: any[]): any | undefined {
  if (!installers?.length) return undefined;
  return (
    installers.find((i) => i.Architecture === "x64" && i.InstallerType?.toLowerCase() === "msi") ??
    installers.find((i) => i.Architecture === "x64" && i.InstallerType !== "portable") ??
    installers.find((i) => i.Architecture === "x86") ??
    installers[0]
  );
}

function toInstallerInfo(i: any): InstallerInfo | null {
  if (!i?.InstallerUrl) return null;
  return {
    url: i.InstallerUrl,
    sha256: i.InstallerSha256 ?? "",
    type: (i.InstallerType ?? "exe").toLowerCase() as InstallerInfo["type"],
    architecture: (i.Architecture ?? "x64").toLowerCase() as InstallerInfo["architecture"],
    scope: i.Scope?.toLowerCase() as InstallerInfo["scope"],
    switchSilent:
      i.InstallerSwitches?.Silent ??
      i.InstallerSwitches?.SilentWithProgress ??
      i.InstallerSwitches?.Custom,
  };
}

// ── Source 1: winget.run API ──────────────────────────────────────────────────
// Fast, no rate limit. Response shape has changed over time — try all paths.

async function fetchFromWingetRun(wingetId: string): Promise<InstallerInfo | null> {
  try {
    const { data } = await axios.get(`${WINGET_RUN}/${encodeURIComponent(wingetId)}`, {
      timeout: 10_000,
    });

    const installers: any[] =
      data?.Data?.Versions?.[0]?.Installers ??   // v2 shape (current)
      data?.Versions?.[0]?.Installers ??           // alt v2
      data?.Latest?.Installers ??                  // legacy
      data?.Packages?.[0]?.Versions?.[0]?.Installers ?? // search-result shape
      [];

    return toInstallerInfo(pickPreferred(installers));
  } catch {
    return null;
  }
}

// ── Source 2: GitHub Raw (direct, no API, no rate limit) ─────────────────────
// Constructs the raw manifest URL from the known version string.
// No GitHub API call — no rate limiting at all.

async function fetchFromGitHubRaw(wingetId: string, version: string): Promise<InstallerInfo | null> {
  try {
    const [publisher, ...rest] = wingetId.split(".");
    const packageName = rest.join(".");
    if (!publisher || !packageName) return null;

    const prefix = publisher[0].toLowerCase();
    const url = `${GITHUB_RAW}/${prefix}/${publisher}/${packageName}/${version}/${publisher}.${packageName}.installer.yaml`;

    const { data: text } = await axios.get(url, { timeout: 10_000 });

    // Use the proper YAML parser — no more regex fragility
    const manifest = parseYaml(text);
    const installers: any[] = manifest?.Installers ?? [];

    return toInstallerInfo(pickPreferred(installers));
  } catch {
    return null;
  }
}

// ── Source 3: GitHub API (version discovery fallback) ────────────────────────
// Used when the stored version doesn't match the manifest path exactly.
// Rate-limited to 60/hour unauthenticated, 5000/hour with GITHUB_TOKEN.

async function fetchFromGitHubApi(wingetId: string): Promise<InstallerInfo | null> {
  try {
    const [publisher, ...rest] = wingetId.split(".");
    const packageName = rest.join(".");
    if (!publisher || !packageName) return null;

    const prefix = publisher[0].toLowerCase();

    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (config.GITHUB_TOKEN) {
      headers["Authorization"] = `token ${config.GITHUB_TOKEN}`;
    }

    const { data: entries } = await axios.get(
      `${GITHUB_API}/${prefix}/${publisher}/${packageName}`,
      { timeout: 10_000, headers }
    );

    // Sort version dirs numerically, skip channel names (Beta, Canary, Dev, EXE)
    const versions: string[] = (entries as any[])
      .filter((e: any) => e.type === "dir" && /^\d/.test(e.name))
      .map((e: any) => e.name)
      .sort((a: string, b: string) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });

    if (!versions.length) return null;

    // Fetch the installer YAML for the latest discovered version
    const latest = versions[0];
    const rawUrl = `${GITHUB_RAW}/${prefix}/${publisher}/${packageName}/${latest}/${publisher}.${packageName}.installer.yaml`;
    const { data: text } = await axios.get(rawUrl, { timeout: 10_000 });

    const manifest = parseYaml(text);
    const installers: any[] = manifest?.Installers ?? [];

    return toInstallerInfo(pickPreferred(installers));
  } catch {
    return null;
  }
}

// ── SHA-256 verification ──────────────────────────────────────────────────────

function verifySha256(filePath: string, expected: string): boolean {
  if (!expected) return true;
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .toUpperCase();
  return actual === expected.toUpperCase();
}

// ── Main download function ────────────────────────────────────────────────────

export async function downloadInstaller(
  wingetId: string,
  version: string,
  onProgress?: (pct: number, msg: string) => void
): Promise<{ filePath: string; installerType: string; silentSwitch?: string } | null> {
  const emit = (pct: number, msg: string) => onProgress?.(pct, msg);

  emit(5, `Looking up installer for ${wingetId} v${version}...`);

  // Source 1: winget.run (fastest, no rate limit)
  let info = await fetchFromWingetRun(wingetId);
  if (info) emit(10, `[Source: winget.run] Found ${info.type} installer (${info.architecture})`);

  // Source 2: GitHub Raw with known version (no API call, no rate limit)
  if (!info) {
    emit(8, "Trying GitHub manifest (direct raw URL)...");
    info = await fetchFromGitHubRaw(wingetId, version);
    if (info) emit(10, `[Source: GitHub Raw] Found ${info.type} installer (${info.architecture})`);
  }

  // Source 3: GitHub API (discovers latest version directory, rate-limited)
  if (!info) {
    emit(9, "Trying GitHub API for version discovery...");
    info = await fetchFromGitHubApi(wingetId);
    if (info) emit(10, `[Source: GitHub API] Found ${info.type} installer (${info.architecture})`);
  }

  if (!info) {
    emit(5, `No installer URL found for ${wingetId} in any source`);
    return null;
  }

  const hostname = new URL(info.url).hostname;
  emit(12, `Installer URL: ${hostname} (${info.type}, ${info.architecture})`);

  // Build local cache path
  const ext = info.type === "msi" ? ".msi" : info.type === "msix" ? ".msix" : ".exe";
  const safeId = wingetId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `${safeId}_${version.replace(/\./g, "_")}${ext}`;
  const filePath = path.join(path.resolve(config.UPLOADS_DIR), fileName);

  // Use cached file if valid
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    emit(50, `Using cached installer (${sizeMb} MB)`);
    return { filePath, installerType: info.type, silentSwitch: info.switchSilent };
  }

  emit(14, `Downloading from ${hostname}...`);

  const writer = fs.createWriteStream(filePath);
  const response = await axios.get(info.url, {
    responseType: "stream",
    timeout: 300_000,
    maxContentLength: 2 * 1024 * 1024 * 1024,
    headers: { "User-Agent": "AutoPack/1.0 Intune-Packaging-Tool" },
  });

  const totalBytes = parseInt(String(response.headers["content-length"] ?? "0"), 10);
  let downloaded = 0;

  await new Promise<void>((resolve, reject) => {
    response.data.on("data", (chunk: Buffer) => {
      downloaded += chunk.length;
      if (totalBytes > 0) {
        const pct = Math.round((downloaded / totalBytes) * 35) + 15;
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        const total = (totalBytes / 1024 / 1024).toFixed(1);
        emit(pct, `Downloading... ${mb} MB / ${total} MB`);
      }
    });
    response.data.pipe(writer);
    response.data.on("error", reject);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  emit(52, "Download complete — verifying SHA-256...");

  if (!verifySha256(filePath, info.sha256)) {
    fs.unlinkSync(filePath);
    throw new Error(`SHA-256 mismatch for ${wingetId} — file may be corrupted`);
  }

  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
  emit(55, `Checksum verified ✓  (${sizeMb} MB)`);

  return { filePath, installerType: info.type, silentSwitch: info.switchSilent };
}

// ── Install command inference ─────────────────────────────────────────────────

export function inferInstallCmd(
  appName: string,
  installerType: string,
  silentSwitch?: string,
  fileName?: string
): { installCmd: string; uninstallCmd: string; detectionMethod: string } {
  const exe = fileName ?? `${appName.replace(/\s+/g, "_")}_setup.exe`;

  if (installerType === "msi") {
    return {
      installCmd: `msiexec /i "${exe}" /qn /norestart REBOOT=ReallySuppress`,
      uninstallCmd: `msiexec /x "{PRODUCT_CODE}" /qn`,
      detectionMethod: `Registry: HKLM\\SOFTWARE\\${appName}`,
    };
  }

  const silent = silentSwitch ?? "/S";
  return {
    installCmd: `"${exe}" ${silent}`,
    uninstallCmd: `"${exe}" /uninstall ${silent}`,
    detectionMethod: `Registry: HKLM\\SOFTWARE\\${appName}`,
  };
}
