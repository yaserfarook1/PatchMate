import fs from "fs";
import path from "path";

export type InstallerFramework =
  | "NSIS"
  | "InnoSetup"
  | "WiX"
  | "InstallShield"
  | "MSI"
  | "MSIX"
  | "Unknown";

export interface DetectionResult {
  framework: InstallerFramework;
  silentSwitch: string;
  msiProductCode?: string;
}

// ── Binary chunk readers ──────────────────────────────────────────────────────

function readHead(filePath: string, maxBytes = 256 * 1024): Buffer {
  const size = Math.min(fs.statSync(filePath).size, maxBytes);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, 0);
  fs.closeSync(fd);
  return buf;
}

function readTail(filePath: string, tailBytes = 64 * 1024): Buffer {
  const stat = fs.statSync(filePath);
  const size = Math.min(stat.size, tailBytes);
  const offset = Math.max(0, stat.size - tailBytes);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, offset);
  fs.closeSync(fd);
  return buf;
}

function contains(buf: Buffer, search: string): boolean {
  return (
    buf.indexOf(Buffer.from(search, "utf8")) !== -1 ||
    buf.indexOf(Buffer.from(search, "utf16le")) !== -1 ||
    buf.indexOf(Buffer.from(search, "latin1")) !== -1
  );
}

// ── MSI ProductCode extraction (OLE2 / Compound Document) ────────────────────

function extractMsiProductCode(filePath: string): string | undefined {
  try {
    // Verify OLE2 Compound Document magic: D0 CF 11 E0 A1 B1 1A E1
    const header = Buffer.alloc(8);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);

    const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (!header.equals(OLE2_MAGIC)) return undefined;

    // Scan entire file as latin-1 for GUID patterns
    const content = fs.readFileSync(filePath);
    const asStr = content.toString("latin1");
    const guidPattern = /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/gi;
    const matches = asStr.match(guidPattern);

    if (!matches) return undefined;

    // Filter out well-known placeholder GUIDs
    return matches
      .map((g) => g.toUpperCase())
      .find(
        (g) =>
          !g.startsWith("{00000000-") &&
          !g.startsWith("{FFFFFFFF-") &&
          !g.startsWith("{00020420-") && // OLE automation
          !g.startsWith("{00020424-")
      );
  } catch {
    return undefined;
  }
}

// ── Main detection function ───────────────────────────────────────────────────

export function detectInstallerFramework(filePath: string): DetectionResult {
  const ext = path.extname(filePath).toLowerCase();

  // ── MSIX / AppX ─────────────────────────────────────────────────────────────
  if (ext === ".msix" || ext === ".appx") {
    return { framework: "MSIX", silentSwitch: "" };
  }

  // ── MSI ──────────────────────────────────────────────────────────────────────
  if (ext === ".msi") {
    const productCode = extractMsiProductCode(filePath);
    return {
      framework: "MSI",
      silentSwitch: "/QN /NORESTART REBOOT=ReallySuppress",
      msiProductCode: productCode,
    };
  }

  // ── EXE — binary header analysis ─────────────────────────────────────────────
  if (ext === ".exe") {
    let head: Buffer;
    let tail: Buffer;

    try {
      head = readHead(filePath);
      tail = readTail(filePath);
    } catch {
      return { framework: "Unknown", silentSwitch: "/S" };
    }

    // NSIS — "Nullsoft.NSIS.exehead" in head, or "Nullsoft Install System" appended to tail
    if (
      contains(head, "Nullsoft.NSIS") ||
      contains(head, "Nullsoft Install System") ||
      contains(tail, "Nullsoft Install System") ||
      contains(tail, "nsis.sf.net") ||
      contains(tail, "NSIS Error")
    ) {
      return { framework: "NSIS", silentSwitch: "/S" };
    }

    // InnoSetup — setup stub has "Inno Setup" in PE resources
    if (
      contains(head, "Inno Setup") ||
      contains(tail, "Inno Setup") ||
      contains(head, "innounp") ||
      contains(head, "is_uninst.exe") ||
      contains(head, "InnoSetupVersion")
    ) {
      return {
        framework: "InnoSetup",
        silentSwitch: "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /SP-",
      };
    }

    // WiX Burn bootstrapper
    if (
      contains(head, "WixBurn") ||
      contains(head, ".wixburn") ||
      contains(head, "WiX Bootstrapper") ||
      contains(head, "burn.exe")
    ) {
      return { framework: "WiX", silentSwitch: "/quiet /norestart" };
    }

    // InstallShield
    if (
      contains(head, "InstallShield") ||
      contains(head, "InstallScript") ||
      contains(head, "Macrovision") ||
      contains(head, "isetup.dll")
    ) {
      return {
        framework: "InstallShield",
        silentSwitch: `/s /v"/qn REBOOT=ReallySuppress"`,
      };
    }

    // Embedded MSI (WiX / custom bootstrapper containing .msi)
    const msiMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
    if (head.indexOf(msiMagic) !== -1 || tail.indexOf(msiMagic) !== -1) {
      return { framework: "WiX", silentSwitch: "/quiet /norestart" };
    }
  }

  return { framework: "Unknown", silentSwitch: "/S" };
}
