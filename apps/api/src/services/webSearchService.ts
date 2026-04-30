import axios from "axios";

export interface VulnerabilityResult {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  cveId?: string;
  description: string;
  exploitAvailable: boolean;
  source: string;
  affectedVersions?: string;
}

const SERPER_API_KEY = process.env.SERPER_API_KEY;

export async function searchVulnerabilities(
  appName: string,
  version: string
): Promise<VulnerabilityResult[]> {
  if (!SERPER_API_KEY) {
    console.warn("[WebSearch] No SERPER_API_KEY — using fallback heuristic");
    return fallbackRiskAssessment(appName, version);
  }

  const queries = [
    `${appName} ${version} CVE vulnerability security`,
    `${appName} security advisory ${new Date().getFullYear()}`,
  ];

  const results: VulnerabilityResult[] = [];

  for (const query of queries) {
    try {
      const { data } = await axios.post(
        "https://google.serper.dev/search",
        { q: query, num: 5 },
        { headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" }, timeout: 10_000 }
      );

      for (const item of data.organic ?? []) {
        const vuln = parseSearchResult(item, appName);
        if (vuln) results.push(vuln);
      }
    } catch (err: any) {
      console.warn(`[WebSearch] Query failed: ${query}`, err.message);
    }
  }

  return deduplicateResults(results);
}

function parseSearchResult(
  item: { title: string; snippet: string; link: string },
  appName: string
): VulnerabilityResult | null {
  const text = `${item.title} ${item.snippet}`.toLowerCase();

  if (!text.includes("vulnerab") && !text.includes("cve") && !text.includes("security") && !text.includes("exploit")) {
    return null;
  }

  const cveMatch = text.match(/cve-\d{4}-\d{4,}/i);
  const severity = inferSeverity(text);
  const exploitAvailable = text.includes("exploit") || text.includes("proof of concept") || text.includes("in the wild");

  return {
    title: item.title.substring(0, 120),
    severity,
    cveId: cveMatch?.[0]?.toUpperCase(),
    description: item.snippet.substring(0, 200),
    exploitAvailable,
    source: item.link,
  };
}

function inferSeverity(text: string): VulnerabilityResult["severity"] {
  if (text.includes("critical") || text.includes("rce") || text.includes("remote code execution") || text.includes("zero-day")) return "critical";
  if (text.includes("high") || text.includes("privilege escalation") || text.includes("arbitrary code")) return "high";
  if (text.includes("medium") || text.includes("denial of service") || text.includes("information disclosure")) return "medium";
  return "low";
}

function deduplicateResults(results: VulnerabilityResult[]): VulnerabilityResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.cveId ?? r.title.substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackRiskAssessment(appName: string, version: string): VulnerabilityResult[] {
  const knownHighRisk = ["chrome", "firefox", "edge", "adobe", "java", "flash", "acrobat", "reader", "office", "outlook"];
  const isHighRisk = knownHighRisk.some((k) => appName.toLowerCase().includes(k));

  if (isHighRisk) {
    return [{
      title: `${appName} — outdated version may contain known vulnerabilities`,
      severity: "high",
      description: `${appName} is a commonly targeted application. Running outdated versions increases exposure to known exploits.`,
      exploitAvailable: false,
      source: "heuristic",
    }];
  }

  return [{
    title: `${appName} ${version} — potential unpatched vulnerabilities`,
    severity: "medium",
    description: `Outdated software may contain security vulnerabilities that have been fixed in newer versions.`,
    exploitAvailable: false,
    source: "heuristic",
  }];
}
