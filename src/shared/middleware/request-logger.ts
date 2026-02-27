import type { MiddlewareHandler } from "hono";
import { logger } from "@/shared/utils/logger";

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const duration = Math.round(performance.now() - start);

  const status = c.res.status;
  const logData = {
    method: c.req.method,
    path: c.req.path,
    status,
    duration: `${duration}ms`,
  };

  if (status >= 500) {
    logger.error(logData, "request");
  } else if (status >= 400) {
    logger.warn(logData, "request");
  } else {
    logger.info(logData, "request");
  }
};
