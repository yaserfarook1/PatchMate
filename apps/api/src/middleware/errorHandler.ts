import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);

  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    code: err.code ?? "INTERNAL_ERROR",
    message: err.message ?? "An unexpected error occurred",
  });
}
