import { Router } from "express";
import crypto from "crypto";
import axios from "axios";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { config } from "../config.js";
import { redis } from "../lib/redis.js";
import { getCurrentUser, getDeviceCount, getManagedApps } from "../services/graphService.js";

const router = Router();

const GRAPH_SCOPES = config.GRAPH_SCOPES.split(" ").filter(Boolean);

// ── List ──────────────────────────────────────────────────────────────────────

router.get("/", requireAuth, async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { packages: true, patchFlows: true, deviceDiscovery: true } },
    },
  });
  res.json(tenants.map(({ accessToken, refreshToken, clientSecret, ...t }) => t));
});

// ── OAuth: start  (MUST be before /:id) ──────────────────────────────────────

router.post("/oauth-start", requireAuth, requirePermission("TENANT_MANAGE"), async (req, res) => {
  const { azureTenantId, clientId, clientSecret, displayName } = req.body;

  if (!azureTenantId || !clientId || !displayName) {
    res.status(400).json({
      code: "MISSING_PARAMS",
      message: "azureTenantId, clientId, and displayName are required",
    });
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  await redis.set(
    `oauth_state:${state}`,
    JSON.stringify({ azureTenantId, clientId, clientSecret: clientSecret ?? "", displayName }),
    "EX",
    600
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: config.AZURE_OAUTH_REDIRECT_URI,
    response_mode: "query",
    scope: GRAPH_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });

  const authUrl = `https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0/authorize?${params}`;
  res.json({ authUrl });
});

// ── OAuth: callback  (MUST be before /:id) ───────────────────────────────────

router.get("/oauth-callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;

  if (error) {
    console.error("OAuth error:", error, error_description);
    return res.redirect(
      `${config.FRONTEND_URL}/tenants/connect?error=${encodeURIComponent(error_description ?? error)}`
    );
  }

  if (!code || !state) {
    return res.redirect(`${config.FRONTEND_URL}/tenants/connect?error=missing_params`);
  }

  const raw = await redis.get(`oauth_state:${state}`);
  if (!raw) {
    return res.redirect(`${config.FRONTEND_URL}/tenants/connect?error=state_expired`);
  }
  await redis.del(`oauth_state:${state}`);

  const { azureTenantId, clientId, clientSecret, displayName } = JSON.parse(raw);

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    code,
    redirect_uri: config.AZURE_OAUTH_REDIRECT_URI,
    grant_type: "authorization_code",
    scope: GRAPH_SCOPES.join(" "),
  });

  if (clientSecret) {
    tokenParams.set("client_secret", clientSecret);
  }

  let tokenData: any;
  try {
    const { data } = await axios.post(
      `https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0/token`,
      tokenParams,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    tokenData = data;
  } catch (err: any) {
    const msg = err.response?.data?.error_description ?? "Token exchange failed";
    console.error("Token exchange error:", msg);
    return res.redirect(
      `${config.FRONTEND_URL}/tenants/connect?error=${encodeURIComponent(msg)}`
    );
  }

  const { access_token, refresh_token, expires_in } = tokenData;
  const tokenExpiresAt = new Date(Date.now() + (expires_in - 60) * 1000);

  let userInfo = { id: "", mail: "", displayName: "" };
  let deviceCount = 0;

  try {
    userInfo = await getCurrentUser(access_token);
  } catch {
    // non-fatal
  }

  try {
    const { data: countData } = await axios.get(
      "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$count",
      { headers: { Authorization: `Bearer ${access_token}`, ConsistencyLevel: "eventual" } }
    );
    deviceCount = typeof countData === "number" ? countData : parseInt(countData, 10) || 0;
  } catch {
    // non-fatal
  }

  let org = await prisma.organisation.findFirst();
  if (!org) {
    org = await prisma.organisation.create({
      data: { id: "org_default", name: "My Organisation" },
    });
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: `tenant_${azureTenantId}` },
    update: {
      displayName,
      intuneClientId: clientId,
      azureTenantId,
      clientSecret: clientSecret || null,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      tokenExpiresAt,
      lastSyncAt: new Date(),
    },
    create: {
      id: `tenant_${azureTenantId}`,
      orgId: org.id,
      displayName,
      intuneClientId: clientId,
      azureTenantId,
      clientSecret: clientSecret || null,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      tokenExpiresAt,
      deviceCount,
    },
  });

  if (userInfo.mail) {
    try {
      await prisma.user.upsert({
        where: { azureObjectId: userInfo.id },
        update: { name: userInfo.displayName, email: userInfo.mail },
        create: {
          azureObjectId: userInfo.id,
          email: userInfo.mail,
          name: userInfo.displayName,
          role: "Admin",
          tenantId: tenant.id,
        },
      });
    } catch {
      // non-fatal if duplicate email
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: "user_admin_seed",
      action: "TENANT_CONNECTED",
      resourceType: "Tenant",
      resourceId: tenant.id,
      details: { displayName, azureTenantId, connectedBy: userInfo.mail },
    },
  });

  res.redirect(`${config.FRONTEND_URL}/tenants?connected=${tenant.id}`);
});

// ── Single tenant  (/:id last, after all named routes) ───────────────────────

router.get("/:id", requireAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: {
      org: true,
      _count: { select: { packages: true, patchFlows: true, deviceDiscovery: true } },
    },
  });

  if (!tenant) {
    res.status(404).json({ code: "NOT_FOUND", message: "Tenant not found" });
    return;
  }
  const { accessToken, refreshToken, clientSecret, ...safe } = tenant;
  res.json(safe);
});

// ── Sync device count ─────────────────────────────────────────────────────────

router.post("/:id/sync", requireAuth, requirePermission("TENANT_MANAGE"), async (req, res) => {
  let deviceCount = 0;
  try {
    deviceCount = await getDeviceCount(req.params.id);
  } catch (err) {
    console.warn("Could not refresh device count:", (err as Error).message);
  }

  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { lastSyncAt: new Date(), ...(deviceCount > 0 && { deviceCount }) },
  });

  const { accessToken: _a, refreshToken: _r, clientSecret: _c, ...safeTenant } = tenant;
  res.json(safeTenant);
});

// ── Update ────────────────────────────────────────────────────────────────────

router.patch("/:id", requireAuth, requirePermission("TENANT_MANAGE"), async (req, res) => {
  const { displayName } = req.body;

  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: { ...(displayName && { displayName }) },
  });

  const { accessToken: _a2, refreshToken: _r2, clientSecret: _c2, ...safePatch } = tenant;
  res.json(safePatch);
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/:id", requireAuth, requirePermission("TENANT_MANAGE"), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) {
    res.status(404).json({ code: "NOT_FOUND", message: "Tenant not found" });
    return;
  }

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      action: "TENANT_DISCONNECTED",
      resourceType: "Tenant",
      resourceId: req.params.id,
      details: { displayName: tenant.displayName },
    },
  });

  const tid = req.params.id;

  // Delete all related records first (foreign key constraints)
  await prisma.deviceDiscovery.deleteMany({ where: { tenantId: tid } });
  await prisma.deploymentJob.deleteMany({
    where: { package: { tenantId: tid } },
  });
  await prisma.wave.deleteMany({
    where: { flow: { tenantId: tid } },
  });
  await prisma.patchFlow.deleteMany({ where: { tenantId: tid } });
  await prisma.package.deleteMany({ where: { tenantId: tid } });

  await prisma.tenant.delete({ where: { id: tid } });
  res.status(204).send();
});

// ── Entra groups (for wave builder) ──────────────────────────────────────────

router.get("/:id/groups", requireAuth, async (req, res) => {
  const { getGroups } = await import("../services/graphService.js");
  try {
    const groups = await getGroups(req.params.id);
    res.json(groups);
  } catch (err) {
    res.status(502).json({ code: "GRAPH_ERROR", message: (err as Error).message });
  }
});

// ── Sync managed apps from Intune ─────────────────────────────────────────────

router.post("/:id/sync-apps", requireAuth, requirePermission("TENANT_MANAGE"), async (req, res) => {
  const tenantId = req.params.id;

  let graphApps;
  try {
    graphApps = await getManagedApps(tenantId);
  } catch (err: any) {
    console.error("[sync-apps] Graph error:", err.message);
    res.status(502).json({
      code: "GRAPH_ERROR",
      message: err.message,
      hint: "Check that DeviceManagementApps.ReadWrite.All has admin consent in Azure Portal → App Registrations → API permissions.",
    });
    return;
  }

  let created = 0;
  let updated = 0;

  for (const gApp of graphApps) {
    const wingetId = `Intune.${gApp.id}`;
    const existing = await prisma.app.findUnique({ where: { wingetId } });

    if (existing) {
      await prisma.app.update({
        where: { wingetId },
        data: {
          name: gApp.displayName,
          publisher: gApp.publisher ?? existing.publisher,
          latestVersion: gApp.displayVersion ?? gApp.appVersion ?? existing.latestVersion,
          // Keep existing status — don't downgrade "validated" back to "pending"
          // if a package was already built for this app.
        },
      });
      updated++;
    } else {
      await prisma.app.create({
        data: {
          wingetId,
          name: gApp.displayName,
          publisher: gApp.publisher ?? "Unknown",
          latestVersion: gApp.displayVersion ?? gApp.appVersion ?? "1.0",
          // "pending" = exists in Intune but no AutoPack package built yet
          status: "pending",
          description: gApp.description ?? null,
          category: "Managed",
        },
      });
      created++;
    }
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { lastSyncAt: new Date() },
  });

  res.json({ synced: graphApps.length, created, updated });
});

export default router;
