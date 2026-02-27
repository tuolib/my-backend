import { Hono } from "hono";
import { sql } from "@ho/database";
import { redisIns } from "@ho/database";

const health = new Hono();

health.get("/health", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await sql`SELECT 1`;
    checks.pg = "ok";
  } catch {
    checks.pg = "fail";
  }

  try {
    await redisIns.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "fail";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return c.json(checks, healthy ? 200 : 503);
});

export { health };
