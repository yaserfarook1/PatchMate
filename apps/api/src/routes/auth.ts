import { Router } from "express";
import crypto from "crypto";
import axios from "axios";
import jwt from "jsonwebtoken";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { redis } from "../lib/redis.js";

const router = Router();

// ── Microsoft OAuth login (primary auth flow) ────────────────────────────────

router.get("/microsoft", async (req, res) => {
  // Get the Azure App Registration credentials from the connected tenant
  const tenant = await prisma.tenant.findFirst();
  if (!tenant?.intuneClientId || !tenant?.azureTenantId) {
    res.status(503).json({
      code: "NO_TENANT",
      message: "No Intune tenant connected yet — connect one first, then users can sign in.",
    });
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  await redis.set(`auth_state:${state}`, "pending", "EX", 600);

  const params = new URLSearchParams({
    client_id: tenant.intuneClientId,
    response_type: "code",
    redirect_uri: `${config.FRONTEND_URL}/auth/callback`,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    prompt: "select_account",
  });

  const authUrl = `https://login.microsoftonline.com/${tenant.azureTenantId}/oauth2/v2.0/authorize?${params}`;
  res.json({ authUrl });
});

// ── Microsoft OAuth callback (exchanged on frontend, token sent here) ─────────

router.post("/microsoft-callback", async (req, res) => {
  const { code, state } = req.body;

  if (!code || !state) {
    res.status(400).json({ code: "MISSING_PARAMS", message: "code and state required" });
    return;
  }

  // Verify state
  const pending = await redis.get(`auth_state:${state}`);
  if (!pending) {
    res.status(400).json({ code: "STATE_EXPIRED", message: "Auth state expired — try again" });
    return;
  }
  await redis.del(`auth_state:${state}`);

  // Get tenant credentials
  const tenant = await prisma.tenant.findFirst();
  if (!tenant?.intuneClientId || !tenant?.azureTenantId) {
    res.status(503).json({ code: "NO_TENANT", message: "No tenant connected" });
    return;
  }

  // Exchange code for tokens
  const tokenParams = new URLSearchParams({
    client_id: tenant.intuneClientId,
    code,
    redirect_uri: `${config.FRONTEND_URL}/auth/callback`,
    grant_type: "authorization_code",
    scope: "openid profile email User.Read",
  });

  if (tenant.clientSecret) {
    tokenParams.set("client_secret", tenant.clientSecret);
  }

  let tokenData: any;
  try {
    const { data } = await axios.post(
      `https://login.microsoftonline.com/${tenant.azureTenantId}/oauth2/v2.0/token`,
      tokenParams,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    tokenData = data;
  } catch (err: any) {
    const msg = err.response?.data?.error_description ?? "Token exchange failed";
    res.status(401).json({ code: "TOKEN_FAILED", message: msg });
    return;
  }

  // Get user info from Microsoft Graph
  let msUser: { id: string; mail: string; displayName: string; userPrincipalName: string };
  try {
    const { data } = await axios.get("https://graph.microsoft.com/v1.0/me?$select=id,mail,displayName,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    msUser = data;
  } catch {
    res.status(401).json({ code: "GRAPH_FAILED", message: "Failed to get user info from Microsoft" });
    return;
  }

  const email = msUser.mail ?? msUser.userPrincipalName;
  const azureObjectId = msUser.id;

  // Check if user is in our allowed list
  let user = await prisma.user.findFirst({
    where: { OR: [{ azureObjectId }, { email }] },
  });

  if (!user || !user.isAllowed) {
    res.status(403).json({
      code: "ACCESS_DENIED",
      message: "You don't have access to PatchMate. Please contact the administrator to request access.",
      email,
      name: msUser.displayName,
    });
    return;
  }

  // Update user record with latest info from Microsoft
  user = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: msUser.displayName,
      email,
      azureObjectId,
    },
  });

  // Issue JWT
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId },
    config.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// ── Bootstrap: first-time setup (only works when no tenant exists) ────────────

router.post("/bootstrap", async (req, res) => {
  const existingTenant = await prisma.tenant.findFirst();
  if (existingTenant) {
    res.status(403).json({ code: "ALREADY_SETUP", message: "Bootstrap disabled — a tenant already exists" });
    return;
  }

  const { azureTenantId, clientId, clientSecret, displayName, adminEmail, adminName } = req.body;
  if (!azureTenantId || !clientId || !displayName || !adminEmail || !adminName) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "azureTenantId, clientId, displayName, adminEmail, adminName required" });
    return;
  }

  let org = await prisma.organisation.findFirst();
  if (!org) {
    org = await prisma.organisation.create({ data: { id: "org_default", name: displayName } });
  }

  const tenant = await prisma.tenant.create({
    data: {
      id: `tenant_${azureTenantId}`,
      orgId: org.id,
      displayName,
      intuneClientId: clientId,
      azureTenantId,
      clientSecret: clientSecret || null,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: adminName, role: "Admin", isAllowed: true },
    create: { email: adminEmail, name: adminName, role: "Admin", isAllowed: true },
  });

  res.status(201).json({ message: "Bootstrap complete", tenantId: tenant.id, userId: user.id });
});

// ── Current user ──────────────────────────────────────────────────────────────

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(404).json({ code: "NOT_FOUND", message: "User not found" });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId });
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post("/logout", requireAuth, (_req, res) => {
  res.status(204).send();
});

// ── Access management (admin only) ────────────────────────────────────────────

router.get("/users", requireAuth, async (req, res) => {
  if (req.user!.role !== "Admin") {
    res.status(403).json({ code: "FORBIDDEN", message: "Admin only" });
    return;
  }

  const users = await prisma.user.findMany({
    where: { isAllowed: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, azureObjectId: true, createdAt: true },
  });

  res.json(users);
});

router.post("/users/grant", requireAuth, async (req, res) => {
  if (req.user!.role !== "Admin") {
    res.status(403).json({ code: "FORBIDDEN", message: "Admin only" });
    return;
  }

  const { email, name, role, azureObjectId } = req.body;
  if (!email || !name) {
    res.status(400).json({ code: "MISSING_FIELDS", message: "email and name required" });
    return;
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role: role || "Member", isAllowed: true, azureObjectId: azureObjectId ?? undefined },
    create: { email, name, role: role || "Member", isAllowed: true, azureObjectId: azureObjectId ?? undefined },
  });

  res.status(201).json(user);
});

router.delete("/users/:id", requireAuth, async (req, res) => {
  if (req.user!.role !== "Admin") {
    res.status(403).json({ code: "FORBIDDEN", message: "Admin only" });
    return;
  }

  // Can't revoke your own access
  if (req.params.id === req.user!.id) {
    res.status(400).json({ code: "SELF_REVOKE", message: "Cannot revoke your own access" });
    return;
  }

  await prisma.user.update({
    where: { id: req.params.id },
    data: { isAllowed: false },
  });

  res.status(204).send();
});

// ── Search Entra directory for users to add ───────────────────────────────────

router.get("/users/search-entra", requireAuth, async (req, res) => {
  if (req.user!.role !== "Admin") {
    res.status(403).json({ code: "FORBIDDEN", message: "Admin only" });
    return;
  }

  const { q } = req.query as { q?: string };
  if (!q || q.length < 2) {
    res.json([]);
    return;
  }

  const tenant = await prisma.tenant.findFirst();
  if (!tenant?.accessToken) {
    res.status(503).json({ code: "NO_TOKEN", message: "No tenant token — reconnect tenant" });
    return;
  }

  try {
    // Try $filter with startswith first (works without ConsistencyLevel)
    const safeQ = q.replace(/'/g, "''");
    let users: any[] = [];

    try {
      const { data } = await axios.get(
        `https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,'${safeQ}') or startswith(mail,'${safeQ}') or startswith(userPrincipalName,'${safeQ}')&$select=id,displayName,mail,userPrincipalName&$top=10`,
        { headers: { Authorization: `Bearer ${tenant.accessToken}` }, timeout: 10_000 }
      );
      users = data.value ?? [];
    } catch {
      // Fallback: use $search with ConsistencyLevel (some tenants require this)
      const { data } = await axios.get(
        `https://graph.microsoft.com/v1.0/users?$search="displayName:${safeQ}"&$select=id,displayName,mail,userPrincipalName&$top=10&$count=true`,
        {
          headers: {
            Authorization: `Bearer ${tenant.accessToken}`,
            ConsistencyLevel: "eventual",
          },
          timeout: 10_000,
        }
      );
      users = data.value ?? [];
    }

    res.json(users.map((u: any) => ({
      azureObjectId: u.id,
      name: u.displayName,
      email: u.mail ?? u.userPrincipalName,
    })));
  } catch (err: any) {
    const msg = err.response?.data?.error?.message ?? err.message;
    console.error("[Entra Search] Failed:", msg);
    res.status(502).json({ code: "GRAPH_ERROR", message: msg });
  }
});

export default router;
