import crypto from "crypto";
import fs from "fs";
import path from "path";
import archiver from "archiver";

export interface IntuneWinResult {
  encryptedFilePath: string;
  encryptionInfo: {
    encryptionKey: string;
    macKey: string;
    initializationVector: string;
    mac: string;
    profileIdentifier: string;
    fileDigest: string;
    fileDigestAlgorithm: string;
  };
  originalSize: number;
  encryptedSize: number;
}

/**
 * Create an Intune-compatible encrypted package from an installer file.
 * Replicates what IntuneWinAppUtil.exe does: ZIP → AES-256-CBC encrypt → metadata.
 */
export async function createIntuneWinPackage(
  installerPath: string,
  outputDir: string
): Promise<IntuneWinResult> {
  const installerFile = path.basename(installerPath);
  const installerSize = fs.statSync(installerPath).size;
  console.log(`[IntuneWinAppUtil] Starting — source: ${installerFile} (${(installerSize / 1024 / 1024).toFixed(1)} MB)`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: ZIP the installer (same as IntuneWinAppUtil's "Compressing the source folder" step)
  const zipPath = path.join(outputDir, "IntunePackage.zip");
  await createZip(installerPath, zipPath);
  const zipSize = fs.statSync(zipPath).size;
  console.log(`[IntuneWinAppUtil] Compressed: ${(zipSize / 1024 / 1024).toFixed(1)} MB`);

  // Step 2: Encrypt the ZIP with AES-256-CBC (ProfileVersion1)
  // Intune encrypted file format: [HMAC 32 bytes][IV 16 bytes][AES-CBC ciphertext w/ PKCS7]
  const zipContent = fs.readFileSync(zipPath);
  const originalSize = zipContent.length;

  const encKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const macKey = crypto.randomBytes(32);

  const fileDigest = crypto.createHash("sha256").update(zipContent).digest("base64");

  const cipher = crypto.createCipheriv("aes-256-cbc", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(zipContent), cipher.final()]);

  // HMAC-SHA256 over IV + ciphertext (Encrypt-then-MAC with authenticated IV)
  const hmac = crypto.createHmac("sha256", macKey);
  hmac.update(iv);
  hmac.update(ciphertext);
  const macDigest = hmac.digest();

  const encryptedContent = Buffer.concat([macDigest, iv, ciphertext]);
  const encryptedFilePath = path.join(outputDir, "IntunePackage.intunewin.bin");
  fs.writeFileSync(encryptedFilePath, encryptedContent);
  const encryptedSize = encryptedContent.length;

  // Cleanup temp ZIP
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

  console.log(`[IntuneWinAppUtil] Encrypted: ${(encryptedSize / 1024 / 1024).toFixed(1)} MB`);
  console.log("[IntuneWinAppUtil] Completed successfully");

  return {
    encryptedFilePath,
    encryptionInfo: {
      encryptionKey: encKey.toString("base64"),
      macKey: macKey.toString("base64"),
      initializationVector: iv.toString("base64"),
      mac: macDigest.toString("base64"),
      profileIdentifier: "ProfileVersion1",
      fileDigest,
      fileDigestAlgorithm: "SHA256",
    },
    originalSize,
    encryptedSize,
  };
}

function createZip(filePath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(filePath, { name: path.basename(filePath) });
    archive.finalize();
  });
}
