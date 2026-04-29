import { Router } from "express";
import { prisma } from "@autopack/database";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";

const router = Router();

router.get("/app/:appId", requireAuth, async (req, res) => {
  const { tenantId } = req.query as { tenantId?: string };
  const activeTenantId = tenantId || req.user?.tenantId;

  const setting = await prisma.customAppSetting.findFirst({
    where: { appId: req.params.appId, tenantId: activeTenantId || undefined },
    include: { app: { select: { id: true, name: true, publisher: true } } },
  });

  if (!setting) {
    const app = await prisma.app.findUnique({
      where: { id: req.params.appId },
      select: { id: true, name: true, publisher: true },
    });
    if (!app) {
      res.status(404).json({ code: "NOT_FOUND", message: "App not found" });
      return;
    }
    res.json({ appId: req.params.appId, tenantId: activeTenantId, installArgs: "", preScript: "", postScript: "", registryValues: {}, app });
    return;
  }

  res.json(setting);
});

router.put("/app/:appId", requireAuth, requirePermission("SETTINGS_EDIT"), async (req, res) => {
  const { tenantId, installArgs, preScript, postScript, registryValues } = req.body;
  const activeTenantId = tenantId || req.user?.tenantId;

  if (!activeTenantId) {
    res.status(400).json({ code: "MISSING_TENANT", message: "tenantId is required" });
    return;
  }

  const existing = await prisma.customAppSetting.findFirst({
    where: { appId: req.params.appId, tenantId: activeTenantId },
  });

  const data = {
    installArgs: installArgs ?? null,
    preScript: preScript ?? null,
    postScript: postScript ?? null,
    registryValues: registryValues ?? null,
  };

  const setting = existing
    ? await prisma.customAppSetting.update({ where: { id: existing.id }, data })
    : await prisma.customAppSetting.create({ data: { ...data, appId: req.params.appId, tenantId: activeTenantId } });

  res.json(setting);
});

export default router;
