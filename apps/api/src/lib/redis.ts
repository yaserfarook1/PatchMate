import IORedis from "ioredis";
import { config } from "../config.js";

export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});
