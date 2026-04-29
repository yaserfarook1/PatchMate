import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import unzipper from "unzipper";

const TOOL_PATH = path.resolve(__dirname, "../../tools/IntuneWinAppUtil.exe");

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
 * Use Microsoft's official IntuneWinAppUtil.exe to create a properly encrypted
 * .intunewin package, then extract the encryption info and encrypted content.
 */
export async function createIntuneWinPackage(
  installerPath: string,
  outputDir: string
): Promise<IntuneWinResult> {
  const installerFile = path.basename(installerPath);

  // Stage installer in an isolated directory — the tool compresses the ENTIRE -c folder
  const stageDir = path.join(outputDir, "_stage");
  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });
  fs.copyFileSync(installerPath, path.join(stageDir, installerFile));

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Run IntuneWinAppUtil.exe (async — doesn't block the event loop)
  console.log(`[IntuneWinAppUtil] Starting — source: ${installerFile} (${(fs.statSync(installerPath).size / 1024 / 1024).toFixed(1)} MB)`);

  await new Promise<void>((resolve, reject) => {
    const proc = execFile(
      TOOL_PATH,
      ["-c", stageDir, "-s", installerFile, "-o", outputDir, "-q"],
      { timeout: 300_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          console.error("[IntuneWinAppUtil] stderr:", stderr);
          reject(new Error(`IntuneWinAppUtil failed: ${err.message}`));
        } else {
          console.log("[IntuneWinAppUtil] Completed successfully");
          resolve();
        }
      }
    );

    proc.stdout?.on("data", (d: string) => {
      const line = d.toString().trim();
      if (line) console.log(`[IntuneWinAppUtil] ${line}`);
    });
  });

  // Clean up staging directory
  try { fs.rmSync(stageDir, { recursive: true }); } catch { /* ignore */ }

  // Find the generated .intunewin file
  const intunewinName = installerFile.replace(/\.[^.]+$/, ".intunewin");
  let finalPath = path.join(outputDir, intunewinName);

  if (!fs.existsSync(finalPath)) {
    const found = fs.readdirSync(outputDir).filter((f) => f.endsWith(".intunewin"));
    if (!found.length) throw new Error("IntuneWinAppUtil produced no .intunewin file");
    finalPath = path.join(outputDir, found[found.length - 1]);
  }

  console.log(`[IntuneWinAppUtil] Output: ${path.basename(finalPath)} (${(fs.statSync(finalPath).size / 1024 / 1024).toFixed(1)} MB)`);

  // Extract Detection.xml and IntunePackage.intunewin from the outer ZIP
  const { encryptionInfo, originalSize } = await extractDetectionXml(finalPath);
  const encryptedFilePath = await extractEncryptedContent(finalPath, outputDir);
  const encryptedSize = fs.statSync(encryptedFilePath).size;

  // Clean up the outer .intunewin ZIP (we only need the extracted encrypted file)
  try { fs.unlinkSync(finalPath); } catch { /* ignore */ }

  return { encryptedFilePath, encryptionInfo, originalSize, encryptedSize };
}

// ── Extract Detection.xml + encrypted content using random-access ZIP ─────────
// unzipper.Open.file() reads the central directory first, then extracts specific
// entries without streaming the entire ZIP sequentially. Much more reliable for
// large files (141MB encrypted content).

async function extractDetectionXml(intunewinPath: string): Promise<{
  encryptionInfo: IntuneWinResult["encryptionInfo"];
  originalSize: number;
}> {
  const directory = await unzipper.Open.file(intunewinPath);
  const xmlEntry = directory.files.find((f) => f.path.endsWith("Detection.xml"));
  if (!xmlEntry) throw new Error("Detection.xml not found in .intunewin");

  const xmlBuffer = await xmlEntry.buffer();
  const xmlContent = xmlBuffer.toString("utf-8");

  const extract = (tag: string): string => {
    const m = xmlContent.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return m?.[1] ?? "";
  };

  return {
    encryptionInfo: {
      encryptionKey: extract("EncryptionKey"),
      macKey: extract("MacKey"),
      initializationVector: extract("InitializationVector"),
      mac: extract("Mac"),
      profileIdentifier: extract("ProfileIdentifier") || "ProfileVersion1",
      fileDigest: extract("FileDigest"),
      fileDigestAlgorithm: extract("FileDigestAlgorithm") || "SHA256",
    },
    originalSize: parseInt(extract("UnencryptedContentSize") || "0", 10),
  };
}

async function extractEncryptedContent(intunewinPath: string, outputDir: string): Promise<string> {
  const directory = await unzipper.Open.file(intunewinPath);
  const contentEntry = directory.files.find((f) =>
    f.path.includes("IntunePackage.intunewin")
  );
  if (!contentEntry) throw new Error("IntunePackage.intunewin not found in package");

  const outputPath = path.join(outputDir, "IntunePackage.intunewin.bin");

  // Stream the entry to disk (avoids loading 141MB into memory)
  await new Promise<void>((resolve, reject) => {
    const readStream = contentEntry.stream();
    const writeStream = fs.createWriteStream(outputPath);
    readStream.pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    readStream.on("error", reject);
  });

  const size = fs.statSync(outputPath).size;
  if (size === 0) throw new Error("Extracted encrypted content is empty");

  console.log(`[IntuneWinAppUtil] Extracted encrypted content: ${(size / 1024 / 1024).toFixed(1)} MB`);
  return outputPath;
}
