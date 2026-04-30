import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { analyzeRisks, getCachedReport } from "../services/riskAnalysisAgent.js";
import { getTenantProfile, learnFromTenant } from "../services/tenantLearningAgent.js";

const router = Router();

router.get("/analysis/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  const cached = await getCachedReport(tenantId);
  if (cached) {
    res.json({ entries: cached.entries, summary: cached.summary, generatedAt: cached.generatedAt, cached: true });
    return;
  }

  res.json({ entries: [], summary: null, cached: false, message: "No report available — trigger a fresh analysis" });
});

router.post("/analysis/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  res.status(202).json({ status: "running", message: "Risk analysis started — this may take 30-60 seconds" });

  // Run in background (don't block response)
  analyzeRisks(tenantId).catch((err) =>
    console.error("[RiskAgent] Analysis failed:", err.message)
  );
});

router.get("/analysis/:tenantId/sync", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  try {
    const result = await analyzeRisks(tenantId);
    res.json({ entries: result.entries, summary: result.summary, generatedAt: new Date(), cached: false });
  } catch (err: any) {
    console.error("[RiskAgent] Sync analysis failed:", err.message);
    res.status(500).json({ code: "ANALYSIS_FAILED", message: err.message });
  }
});

router.get("/tenant-profile/:tenantId", requireAuth, async (req, res) => {
  const { tenantId } = req.params;
  const profile = await getTenantProfile(tenantId);

  if (!profile) {
    res.json({ exists: false, message: "No profile yet — run a Radar scan to build one" });
    return;
  }

  res.json({
    exists: true,
    groupClassifications: profile.groupClassifications,
    appUsagePatterns: profile.appUsagePatterns,
    deviceProfiles: profile.deviceProfiles,
    lastLearnedAt: profile.lastLearnedAt,
  });
});

router.post("/tenant-profile/:tenantId/learn", requireAuth, async (req, res) => {
  const { tenantId } = req.params;

  try {
    await learnFromTenant(tenantId);
    const profile = await getTenantProfile(tenantId);
    res.json({ success: true, profile });
  } catch (err: any) {
    res.status(500).json({ code: "LEARN_FAILED", message: err.message });
  }
});

router.post("/tenant-profile/:tenantId/classify", requireAuth, async (req, res) => {
  const { tenantId } = req.params;
  const { groupId, department, criticality } = req.body;

  if (!groupId || !department) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "groupId and department required" });
    return;
  }

  const { prisma } = await import("@autopack/database");
  const profile = await prisma.tenantProfile.findUnique({ where: { tenantId } });
  if (!profile) {
    res.status(404).json({ code: "NO_PROFILE", message: "Run learning agent first" });
    return;
  }

  const classifications = (profile.groupClassifications as any) ?? {};
  classifications[groupId] = { ...classifications[groupId], department, criticality: criticality ?? "standard" };

  await prisma.tenantProfile.update({
    where: { tenantId },
    data: { groupClassifications: classifications },
  });

  res.json({ success: true });
});

export default router;
