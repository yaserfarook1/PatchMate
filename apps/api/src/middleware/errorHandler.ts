import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Always log full error server-side
  console.error(`[Error] ${req.method} ${req.path}:`, err.message || err);

  const status = err.status ?? err.statusCode ?? 500;

  // In production, don't expose internal error details to clients
  if (config.NODE_ENV === "production" && status === 500) {
    res.status(500).json({
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
    });
    return;
  }

  res.status(status).json({
    code: err.code ?? "ERROR",
    message: err.message ?? "An error occurred",
  });
}
