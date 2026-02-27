import { Hono } from "hono";
import { db } from "../../shared/db";
import { redis } from "../../shared/db/redis";
import { ok, fail } from "../../shared/types/response";
import { sql } from "drizzle-orm";

const health = new Hono();

health.get("/health", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }

  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "down";
  }

  const allUp = Object.values(checks).every((v) => v === "ok");
  const status = allUp ? 200 : 503;

  return c.json(
    allUp
      ? ok("healthy", { uptime: process.uptime(), checks })
      : fail("degraded", { uptime: process.uptime(), checks }),
    status as any,
  );
});

export { health };
