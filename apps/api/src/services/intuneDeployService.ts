import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { prisma } from "@autopack/database";

const GRAPH_BETA = "https://graph.microsoft.com/beta";
const GRAPH_V1   = "https://graph.microsoft.com/v1.0";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeployProgress {
  step: string;
  percent: number;
}

type ProgressCallback = (p: DeployProgress) => void;

interface FileEncryptionInfo {
  encryptionKey: string;
  macKey: string;
  initializationVector: string;
  mac: string;
  profileIdentifier: "ProfileVersion1";
  fileDigest: string;
  fileDigestAlgorithm: "SHA256";
}

// ── Token ─────────────────────────────────────────────────────────────────────

async function getToken(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.accessToken) throw new Error("No access token — reconnect the tenant");
  return tenant.accessToken;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Wrap installer in minimal ZIP (Intune expects decrypted content to be an archive) ──

async function createPackageZip(installerPath: string): Promise<string> {
  const zipPath = `${installerPath}.intunezip`;
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { store: true });
    output.on("close", () => resolve(zipPath));
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(installerPath, { name: path.basename(installerPath) });
    archive.finalize();
  });
}

// ── AES-256-CBC encryption (ProfileVersion1 — Intune Win32 format) ────────────

function encryptFile(filePath: string): {
  encryptedPath: string;
  encryptionInfo: FileEncryptionInfo;
  originalSize: number;
  encryptedSize: number;
} {
  const content = fs.readFileSync(filePath);
  const originalSize = content.length;

  const encKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const macKey = crypto.randomBytes(32);

  const fileDigest = crypto.createHash("sha256").update(content).digest("base64");

  const cipher = crypto.createCipheriv("aes-256-cbc", encKey, iv);
  // File content = ciphertext only (NO IV prefix) — sizeEncrypted stays correct (originalSize + ≤16 PKCS7).
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);

  // HMAC over ciphertext ONLY — no IV prefix.
  // The MSEndpointMgr/IntuneWin32App PowerShell module (confirmed working in production)
  // computes HMAC(macKey, ciphertext) without IV. Intune verifies the same way.
  const hmac = crypto.createHmac("sha256", macKey);
  hmac.update(ciphertext);
  const mac = hmac.digest("base64");

  const encryptedPath = `${filePath}.enc`;
  fs.writeFileSync(encryptedPath, ciphertext);

  return {
    encryptedPath,
    encryptionInfo: {
      encryptionKey: encKey.toString("base64"),
      macKey: macKey.toString("base64"),
      initializationVector: iv.toString("base64"),  // IV as metadata only
      mac,
      profileIdentifier: "ProfileVersion1",
      fileDigest,
      fileDigestAlgorithm: "SHA256",
    },
    originalSize,
    encryptedSize: ciphertext.length,  // PKCS7 overhead only, no IV
  };
}

// ── Azure Blob block upload (with retry) ─────────────────────────────────────

async function uploadToBlob(
  uploadUrl: string,
  filePath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const content = fs.readFileSync(filePath);
  const blockSize = 4 * 1024 * 1024; // 4 MB per block
  const blockIds: string[] = [];
  const totalBlocks = Math.ceil(content.length / blockSize);

  console.log(`[Blob] Uploading ${(content.length / 1024 / 1024).toFixed(1)} MB in ${totalBlocks} blocks`);

  for (let offset = 0; offset < content.length; offset += blockSize) {
    const blockIndex = blockIds.length;
    const chunk = content.slice(offset, Math.min(offset + blockSize, content.length));
    const blockId = Buffer.from(`blk${String(blockIndex).padStart(8, "0")}`).toString("base64");

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await axios.put(
          `${uploadUrl}&comp=block&blockid=${encodeURIComponent(blockId)}`,
          chunk,
          {
            headers: {
              "x-ms-blob-type": "BlockBlob",
              "Content-Type": "application/octet-stream",
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60_000,
          }
        );
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(
            `[Blob] Block ${blockIndex + 1}/${totalBlocks} failed (attempt ${attempt}): ${err.code ?? err.message}. Retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastError) {
      throw new Error(
        `Blob upload failed at block ${blockIndex + 1}/${totalBlocks} after 3 retries: ${lastError.message}`
      );
    }

    blockIds.push(blockId);
    onProgress?.({
      step: `Uploading block ${blockIndex + 1}/${totalBlocks}...`,
      percent: 55 + Math.round(((blockIndex + 1) / totalBlocks) * 15),
    });
  }

  console.log(`[Blob] All ${totalBlocks} blocks uploaded — committing block list`);

  await axios.put(`${uploadUrl}&comp=blocklist`,
    `<?xml version="1.0" encoding="utf-8"?><BlockList>` +
    blockIds.map((id) => `<Latest>${id}</Latest>`).join("") +
    `</BlockList>`,
    { headers: { "Content-Type": "application/xml" }, timeout: 30_000 }
  );
}

// ── Wait for Intune to process the committed file ─────────────────────────────

async function waitForFileState(
  token: string,
  appId: string,
  versionId: string,
  fileId: string,
  maxMs = 90_000
): Promise<void> {
  const url = `${GRAPH_V1}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${versionId}/files/${fileId}`;
  const deadline = Date.now() + maxMs;

  let lastState = "";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const { data } = await axios.get(url, { headers: authHeaders(token) });

    const state = data.uploadState ?? "unknown";
    if (state !== lastState) {
      console.log(`[Intune] File state: ${state} (size: ${data.size}, sizeEncrypted: ${data.sizeEncrypted})`);
      lastState = state;
    }

    if (state === "commitFileSuccess") return;
    if (state === "commitFileFailed" || state === "azureStorageUriRequestFailed" || state === "commitFileTimedOut") {
      console.error(`[Intune] Commit failed — full response:`, JSON.stringify(data, null, 2));
      throw new Error(`File upload failed with state: ${state}`);
    }
  }
  throw new Error("Timed out waiting for Intune to process the uploaded file");
}

// ── Detection rules from stored string ───────────────────────────────────────
// Graph beta uses win32LobAppRegistryRule / win32LobAppFileSystemRule /
// win32LobAppProductCodeRule — NOT the older *Detection variants.
// Each rule needs ruleType="detection", operationType (not detectionType),
// and comparisonValue (not detectionValue).

function buildDetectionRules(detectionMethod: string | null): object[] {
  if (detectionMethod?.startsWith("Registry:")) {
    const m = detectionMethod.match(/Registry:\s*(HKLM|HKCU)\\(.+)/i);
    if (m) {
      const parts = m[2].split("\\");
      const valueName = parts.length > 1 ? parts.pop()! : "";
      return [{
        "@odata.type": "#microsoft.graph.win32LobAppRegistryRule",
        ruleType: "detection",
        keyPath: `${m[1]}\\${parts.join("\\")}`,
        valueName,
        operationType: "exists",
        operator: "notConfigured",
        comparisonValue: null,
        check32BitOn64System: false,
      }];
    }
  }

  if (detectionMethod?.startsWith("File:")) {
    const m = detectionMethod.match(/File:\s*(.+)/i);
    if (m) {
      const fp = m[1].trim();
      const sep = Math.max(fp.lastIndexOf("\\"), fp.lastIndexOf("/"));
      return [{
        "@odata.type": "#microsoft.graph.win32LobAppFileSystemRule",
        ruleType: "detection",
        path: fp.substring(0, sep),
        fileOrFolderName: fp.substring(sep + 1),
        operationType: "exists",
        operator: "notConfigured",
        comparisonValue: null,
        check32BitOn64System: false,
      }];
    }
  }

  if (detectionMethod?.startsWith("MSI")) {
    const m = detectionMethod.match(/\{([0-9A-Fa-f-]+)\}/);
    if (m) {
      return [{
        "@odata.type": "#microsoft.graph.win32LobAppProductCodeRule",
        ruleType: "detection",
        productCode: `{${m[1]}}`,
        productVersionOperator: "notConfigured",
        productVersion: null,
      }];
    }
  }

  if (detectionMethod?.startsWith("Script:")) {
    const appName = detectionMethod.replace("Script:", "").trim();
    const script = [
      `$app = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",`,
      `  "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue |`,
      `  Where-Object { $_.DisplayName -like "*${appName}*" }`,
      `if ($app) { Write-Output "Detected"; exit 0 } else { exit 1 }`,
    ].join("\n");
    return buildScriptDetectionRule(script);
  }

  // Fallback: PowerShell script searching Uninstall registry
  return buildScriptDetectionRule([
    `$app = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",`,
    `  "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue |`,
    `  Where-Object { $_.DisplayName -ne $null }`,
    `if ($app) { Write-Output "Detected"; exit 0 } else { exit 1 }`,
  ].join("\n"));
}

// ── PowerShell script detection rule ─────────────────────────────────────────

export function buildScriptDetectionRule(scriptContent: string): object[] {
  return [{
    "@odata.type": "#microsoft.graph.win32LobAppPowerShellScriptRule",
    ruleType: "detection",
    enforceSignatureCheck: false,
    runAs32Bit: false,
    scriptContent: Buffer.from(scriptContent, "utf-8").toString("base64"),
  }];
}

// ── Create new Win32 LOB app in Intune + upload package ───────────────────────

async function createWin32App(
  token: string,
  params: {
    displayName: string;
    publisher: string;
    description: string;
    installCmd: string;
    uninstallCmd: string;
    detectionMethod: string | null;
    detectionScriptContent?: string | null;
    filePath: string; // must be the raw installer binary (.exe/.msi/.msix)
  },
  onProgress: ProgressCallback
): Promise<string> {
  // v1.0 is more stable for Win32 LOB operations than beta
  const client = axios.create({ baseURL: GRAPH_V1, headers: authHeaders(token) });

  onProgress({ step: "Creating app record in Intune...", percent: 15 });

  // Use PS1 detection script if available, otherwise fall back to rule-based
  const detectionRules = params.detectionScriptContent
    ? buildScriptDetectionRule(params.detectionScriptContent)
    : buildDetectionRules(params.detectionMethod);

  const installerFileName = path.basename(params.filePath);
  const ext = path.extname(installerFileName).toLowerCase();

  // Derive real install/uninstall commands from the uploaded file type.
  // pkg.installCmd may contain a PSADT command — that's for local use only.
  // Intune needs commands that work against the uploaded binary directly.
  const isMsi = ext === ".msi";
  const isMsix = ext === ".msix" || ext === ".appx";

  let installCmd: string;
  let uninstallCmd: string;

  if (isMsix) {
    installCmd  = `powershell.exe -ExecutionPolicy Bypass -Command "Add-AppxPackage -Path '${installerFileName}'"`;
    uninstallCmd = `powershell.exe -ExecutionPolicy Bypass -Command "Get-AppxPackage -Name '*${params.displayName}*' | Remove-AppxPackage"`;
  } else if (isMsi) {
    // Extract product code from detectionMethod if we have one
    const msiMatch = params.detectionMethod?.match(/MSI:\s*(\{[^}]+\})/i);
    installCmd   = `msiexec /i "${installerFileName}" /qn /norestart REBOOT=ReallySuppress`;
    uninstallCmd = msiMatch
      ? `msiexec /x "${msiMatch[1]}" /qn /norestart`
      : `msiexec /x "${installerFileName}" /qn /norestart`;
  } else {
    // EXE — use stored command but strip PSADT if present (it references a file not in the upload)
    const rawInstall = params.installCmd.includes("Deploy-Application.ps1")
      ? `"${installerFileName}" /S`
      : params.installCmd;
    const rawUninstall = params.uninstallCmd.includes("Deploy-Application.ps1")
      ? `"${installerFileName}" /uninstall /S`
      : params.uninstallCmd;
    installCmd   = rawInstall;
    uninstallCmd = rawUninstall;
  }

  const { data: app } = await client.post("/deviceAppManagement/mobileApps", {
    "@odata.type": "#microsoft.graph.win32LobApp",
    displayName: params.displayName,
    publisher: params.publisher || "Unknown",
    description: params.description || "",
    fileName: installerFileName,
    setupFilePath: installerFileName,   // required — tells Intune which file to execute
    installCommandLine: installCmd,
    uninstallCommandLine: uninstallCmd,
    installExperience: {
      runAsAccount: "system",
      deviceRestartBehavior: "suppress",
    },
    returnCodes: [
      { returnCode: 0, type: "success" },
      { returnCode: 1707, type: "success" },
      { returnCode: 3010, type: "softReboot" },
      { returnCode: 1641, type: "hardReboot" },
      { returnCode: 1618, type: "retry" },
    ],
    rules: detectionRules,
    minimumSupportedWindowsRelease: "1607",
  });

  const appId: string = app.id;

  onProgress({ step: "Creating content version...", percent: 25 });

  const { data: version } = await client.post(
    `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions`,
    {}
  );
  const versionId: string = version.id;

  onProgress({ step: "Creating .intunewin package (Microsoft IntuneWinAppUtil)...", percent: 33 });

  // Use Microsoft's official IntuneWinAppUtil.exe to create the encrypted package.
  // This guarantees the EXACT format Intune expects — no custom encryption needed.
  const { createIntuneWinPackage } = await import("./intunePackageService.js");
  const outputDir = path.resolve(path.dirname(params.filePath), "intunewin_output");

  const { encryptedFilePath, encryptionInfo, originalSize, encryptedSize } =
    await createIntuneWinPackage(params.filePath, outputDir);

  const encryptedPath = encryptedFilePath;

  console.log(`[Intune] IntuneWinAppUtil output — original: ${originalSize}, encrypted: ${encryptedSize}`);
  console.log(`[Intune] Encryption keys extracted from Detection.xml ✓`);

  onProgress({ step: "Creating file entry in Intune...", percent: 43 });

  // The file name in the content version must end with .intunewin —
  // Intune's content pipeline validates the extension.
  const contentFileName = `${params.displayName.replace(/[^a-zA-Z0-9_-]/g, "_")}.intunewin`;

  const fileCreateBody = {
    name: contentFileName,
    size: originalSize,
    sizeEncrypted: encryptedSize,
    isDependency: false,
  };

  console.log(`[Intune] Creating file entry — appId: ${appId}, versionId: ${versionId}`);
  console.log(`[Intune] File body:`, JSON.stringify(fileCreateBody));

  let fileEntry: any;
  try {
    const { data } = await client.post(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${versionId}/files`,
      fileCreateBody
    );
    fileEntry = data;
  } catch (err: any) {
    // Surface the exact Intune validation error
    const detail = err.response?.data?.Message ?? err.response?.data?.message ?? err.message;
    const status = err.response?.status ?? "unknown";
    console.error(`[Intune] File entry creation failed (HTTP ${status}):`, JSON.stringify(err.response?.data ?? err.message, null, 2));
    // Clean up the partially created app to avoid Intune garbage
    try { await client.delete(`/deviceAppManagement/mobileApps/${appId}`); } catch { /* ignore */ }
    throw new Error(`Intune file creation failed (${status}): ${detail}`);
  }

  const fileId: string = fileEntry.id;
  onProgress({ step: "Requesting Azure Blob upload URL...", percent: 45 });

  // Poll until Intune provides the Azure Blob upload URL
  let uploadUrl: string | undefined = fileEntry.azureStorageUri;
  const urlDeadline = Date.now() + 30_000;
  while (!uploadUrl && Date.now() < urlDeadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data: refreshed } = await client.get(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${versionId}/files/${fileId}`
    );
    uploadUrl = refreshed.azureStorageUri;
  }
  if (!uploadUrl) throw new Error("Intune did not provide an upload URL");

  onProgress({ step: "Uploading to Azure Blob Storage...", percent: 55 });

  await uploadToBlob(uploadUrl, encryptedPath, onProgress);
  try { fs.unlinkSync(encryptedPath); } catch { /* ignore */ }

  // Azure needs time to assemble blocks into the final blob.
  // Microsoft's own samples wait 30s here.
  onProgress({ step: "Waiting for Azure to assemble blocks (30s)...", percent: 70 });
  await new Promise((r) => setTimeout(r, 30_000));

  // Retry the commit + poll cycle up to 3 times
  for (let commitAttempt = 1; commitAttempt <= 3; commitAttempt++) {
    onProgress({ step: `Committing to Intune (attempt ${commitAttempt}/3)...`, percent: 75 });

    console.log(`[Intune] Commit attempt ${commitAttempt} — digest: ${encryptionInfo.fileDigest.substring(0, 20)}..., sizeEncrypted: ${encryptedSize}`);

    await client.post(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${versionId}/files/${fileId}/commit`,
      { fileEncryptionInfo: encryptionInfo }
    );

    try {
      await waitForFileState(token, appId, versionId, fileId);
      break; // success — exit retry loop
    } catch (err: any) {
      if (commitAttempt < 3 && err.message.includes("commitFileFailed")) {
        console.warn(`[Intune] Commit attempt ${commitAttempt} failed — retrying in 15s...`);
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      throw err; // final attempt or non-retryable error
    }
  }

  onProgress({ step: "Finalising content version...", percent: 82 });

  await client.patch(`/deviceAppManagement/mobileApps/${appId}`, {
    "@odata.type": "#microsoft.graph.win32LobApp",
    committedContentVersion: versionId,
  });

  return appId;
}

// ── Assign app to Entra group ─────────────────────────────────────────────────

async function assignAppToGroup(
  token: string,
  intuneAppId: string,
  groupId: string,
  intent: "required" | "available" = "required"
): Promise<void> {
  await axios.post(
    `${GRAPH_BETA}/deviceAppManagement/mobileApps/${intuneAppId}/assignments`,
    {
      "@odata.type": "#microsoft.graph.mobileAppAssignment",
      intent,
      target: {
        "@odata.type": "#microsoft.graph.groupAssignmentTarget",
        groupId,
      },
      settings: {
        "@odata.type": "#microsoft.graph.win32LobAppAssignmentSettings",
        notifications: "showAll",
        installTimeSettings: null,
        restartSettings: null,
        deliveryOptimizationPriority: "notConfigured",
      },
    },
    { headers: authHeaders(token) }
  );
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function deployPackageToWave(
  packageId: string,
  waveGroupId: string,
  tenantId: string,
  onProgress: ProgressCallback
): Promise<{ intuneAppId: string }> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { app: true },
  });

  if (!pkg?.app) throw new Error("Package or app not found");

  const token = await getToken(tenantId);

  let intuneAppId: string;

  if (pkg.app.wingetId.startsWith("Intune.")) {
    // App was synced from this Intune tenant — reuse the existing app record
    intuneAppId = pkg.app.wingetId.replace("Intune.", "");
    onProgress({ step: `Using existing Intune app: ${pkg.app.name}`, percent: 40 });
  } else {
    // New app — create it in Intune and upload the raw installer binary.
    // installerPath = raw .exe/.msi (what Intune decrypts and runs).
    // intuneWinPath = outer zip (used for the Download button only, not for upload).
    const fileToUpload = pkg.installerPath ?? pkg.intuneWinPath;
    if (!fileToUpload || !fs.existsSync(fileToUpload)) {
      throw new Error("Installer file missing — rebuild the package first");
    }

    // Read detection script if available (version-aware PS1)
    let detectionScriptContent: string | null = null;
    if (pkg.detectionScriptPath && fs.existsSync(pkg.detectionScriptPath)) {
      detectionScriptContent = fs.readFileSync(pkg.detectionScriptPath, "utf-8");
    }

    onProgress({ step: "Connecting to Intune...", percent: 10 });

    intuneAppId = await createWin32App(
      token,
      {
        displayName: pkg.app.name,
        publisher: pkg.app.publisher,
        description: pkg.app.description ?? "",
        installCmd: pkg.installCmd ?? `${pkg.app.name.replace(/\s/g, "")}_setup.exe /S`,
        uninstallCmd: pkg.uninstallCmd ?? `Uninstall.exe /S`,
        detectionMethod: pkg.detectionMethod,
        detectionScriptContent,
        filePath: fileToUpload,
      },
      onProgress
    );

    // Persist the Intune app ID so future waves skip the upload step
    await prisma.package.update({
      where: { id: packageId },
      data: { intuneAppId },
    });
  }

  onProgress({ step: `Assigning to Entra group...`, percent: 88 });

  try {
    await assignAppToGroup(token, intuneAppId, waveGroupId, "required");
  } catch (err: any) {
    // 409 = assignment already exists — treat as success
    if (err.response?.status !== 409) throw err;
  }

  await prisma.auditLog.create({
    data: {
      userId: "user_admin_seed",
      action: "APP_DEPLOYED_TO_INTUNE",
      resourceType: "Package",
      resourceId: packageId,
      details: { intuneAppId, groupId: waveGroupId, appName: pkg.app.name },
    },
  });

  return { intuneAppId };
}
