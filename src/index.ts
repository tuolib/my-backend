import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "@/shared/config/env";
import { errorHandler } from "@/shared/middleware/error-handler";
import { requestLogger } from "@/shared/middleware/request-logger";
import { requestId } from "@/shared/middleware/request-id";
import { health } from "@/domain/health/controller";
import { productRoutes } from "@/domain/product/controller";
import { logger } from "@/shared/utils/logger";

const app = new Hono();

// --- Global middleware ---
app.use("*", requestId);
app.use("*", requestLogger);
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    maxAge: 86400,
  }),
);

// --- Routes ---
app.route("/", health);
app.route("/api/v1/products", productRoutes);

// --- Error handler ---
app.onError(errorHandler);

// --- 404 ---
app.notFound((c) => {
  return c.json({ success: false, data: null, error: "Not found" }, 404);
});

// --- Start ---
logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server starting");

export default {
  port: env.PORT,
  fetch: app.fetch,
};
