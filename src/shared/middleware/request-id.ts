import type { MiddlewareHandler } from "hono";

export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
};
