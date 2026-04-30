import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3001),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  UPLOADS_DIR: z.string().default("./uploads"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  AZURE_OAUTH_REDIRECT_URI: z.string().default("http://localhost:3001/api/tenants/oauth-callback"),
  GRAPH_SCOPES: z.string().default("https://graph.microsoft.com/DeviceManagementApps.ReadWrite.All https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All https://graph.microsoft.com/Group.Read.All https://graph.microsoft.com/User.Read offline_access"),
  GITHUB_TOKEN: z.string().optional(),
});

export const config = envSchema.parse(process.env);
