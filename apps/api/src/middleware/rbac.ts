import { Request, Response, NextFunction } from "express";
import { PERMISSIONS, PermissionKey } from "@autopack/shared";

export function requirePermission(permission: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    const allowed = PERMISSIONS[permission] as readonly string[];

    if (!role || !allowed.includes(role)) {
      res.status(403).json({
        code: "FORBIDDEN",
        message: `Insufficient permissions. Required: ${permission}`,
      });
      return;
    }
    next();
  };
}
