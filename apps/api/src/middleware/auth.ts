import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        name: string;
        tenantId?: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.MOCK_AUTH) {
    const mockRole = (req.headers["x-mock-role"] as string) || "Admin";
    req.user = {
      id: "user_admin_seed",
      email: "admin@autopack.dev",
      name: "Alex Admin",
      role: mockRole,
      tenantId: "tenant_prod_seed",
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "No token provided" });
    return;
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as Express.Request["user"];
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ code: "INVALID_TOKEN", message: "Token invalid or expired" });
  }
}
