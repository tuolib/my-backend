import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { AppError } from "../types/errors";
import { fail } from "../types/response";
import { logger } from "../utils/logger";

export function errorHandler(err: Error, c: Context) {
  // Zod validation error
  if (err instanceof ZodError) {
    const messages = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return c.json(fail("Validation failed", { details: messages }), 400);
  }

  // Business error
  if (err instanceof AppError) {
    return c.json(fail(err.message, { code: err.code }), err.statusCode as any);
  }

  // Hono HTTP exception
  if (err instanceof HTTPException) {
    return c.json(fail(err.message), err.status);
  }

  // System error — hide details in production
  logger.error({ err, path: c.req.path, method: c.req.method }, "Unhandled error");
  const message =
    process.env.NODE_ENV === "production" ? "Internal server error" : err.message;
  return c.json(fail(message, { code: "INTERNAL_ERROR" }), 500);
}
