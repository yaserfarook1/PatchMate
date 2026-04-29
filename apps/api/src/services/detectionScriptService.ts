import fs from "fs";
import path from "path";
import { config } from "../config.js";
import type { InstallerFramework } from "./installerDetectionService.js";

export interface DetectionScriptOptions {
  packageId: string;
  appName: string;
  version: string;
  framework: InstallerFramework;
  msiProductCode?: string;
}

export function generateDetectionScript(opts: DetectionScriptOptions): string {
  const { appName, version, framework, msiProductCode } = opts;
  const ts = new Date().toISOString();

  // ── MSI with known ProductCode — fast, precise GUID lookup ───────────────────
  if ((framework === "MSI") && msiProductCode) {
    return `# AutoPack Detection Script — ${appName} v${version}
# Generated: ${ts}   Method: MSI ProductCode

$productCode    = '${msiProductCode}'
$requiredVersion = [version]'${version}'

foreach ($hive in @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
                    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
    $key = Join-Path $hive $productCode
    if (Test-Path $key) {
        $app = Get-ItemProperty $key -ErrorAction SilentlyContinue
        if ($app -and $app.DisplayVersion) {
            try {
                $installed = [version]($app.DisplayVersion -replace '[^\\d\\.]','')
                if ($installed -ge $requiredVersion) {
                    Write-Host "Detected: $($app.DisplayName) v$($app.DisplayVersion)"
                    exit 0
                }
            } catch { }
        }
    }
}
exit 1
`;
  }

  // ── MSIX / AppX — check installed package list ───────────────────────────────
  if (framework === "MSIX") {
    return `# AutoPack Detection Script — ${appName} v${version}
# Generated: ${ts}   Method: AppX Package

$appName         = '${appName}'
$requiredVersion = [version]'${version}'

try {
    $pkg = Get-AppxPackage -Name "*$appName*" -ErrorAction SilentlyContinue |
           Sort-Object Version -Descending | Select-Object -First 1
    if ($pkg) {
        $installed = [version]$pkg.Version
        if ($installed -ge $requiredVersion) {
            Write-Host "Detected: $($pkg.Name) v$($pkg.Version)"
            exit 0
        }
    }
} catch { }
exit 1
`;
  }

  // ── EXE / Unknown / NSIS / InnoSetup / WiX / InstallShield ──────────────────
  // Scan Uninstall registry hive for DisplayName match + version comparison.
  // Uses [version] cast — strips non-numeric chars first so "1.2.3 (x64)" works.
  return `# AutoPack Detection Script — ${appName} v${version}
# Generated: ${ts}   Method: Uninstall Registry + Version Check

$appName         = '${appName}'
$requiredVersion = [version]'${version}'

$regPaths = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

foreach ($regPath in $regPaths) {
    $entries = Get-ItemProperty $regPath -ErrorAction SilentlyContinue |
               Where-Object { $_.DisplayName -like "*$appName*" -and $_.DisplayVersion }

    foreach ($entry in $entries) {
        try {
            $cleanVer = $entry.DisplayVersion -replace '[^\\d\\.]',''
            if ($cleanVer -match '^\\d+') {
                $installed = [version]$cleanVer
                if ($installed -ge $requiredVersion) {
                    Write-Host "Detected: $($entry.DisplayName) v$($entry.DisplayVersion)"
                    exit 0
                }
            }
        } catch { }
    }
}
exit 1
`;
}

export function writeDetectionScript(packageId: string, content: string): string {
  const dir = path.resolve(config.UPLOADS_DIR, "detection", packageId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, "detection.ps1");
  fs.writeFileSync(scriptPath, content, "utf-8");
  return scriptPath;
}
