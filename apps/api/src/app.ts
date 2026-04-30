import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import apiRouter from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
    })
  );

  // Global rate limit: 200 requests per minute per IP
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: "RATE_LIMITED", message: "Too many requests — try again in a minute" },
    })
  );

  // Stricter limit for auth endpoints
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 60_000,
      max: 15,
      message: { code: "RATE_LIMITED", message: "Too many auth attempts" },
    })
  );

  // Stricter limit for deploy endpoints
  app.use(
    "/api/instant-apps/deploy",
    rateLimit({
      windowMs: 60_000,
      max: 10,
      message: { code: "RATE_LIMITED", message: "Deploy rate limit reached" },
    })
  );

  app.use(morgan(config.NODE_ENV === "development" ? "dev" : "combined"));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api", apiRouter);

  // In production, serve the React frontend as static files
  if (config.NODE_ENV === "production") {
    const path = require("path");
    const frontendDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
