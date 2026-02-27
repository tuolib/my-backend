import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "@core/context";
import { AppError } from "@core/error";
import type { AppLogger } from "@logger/index";
import type { ApiResponse } from "@response/index";

/** 全局错误处理中间件 */
export function errorHandlerMiddleware(
  logger: AppLogger,
  env: "development" | "production" | "test",
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof AppError) {
        if (err.statusCode >= 500) {
          logger.error(
            { err, requestId: c.get("requestId") },
            err.message,
          );
        } else {
          logger.warn(
            { requestId: c.get("requestId"), code: err.code },
            err.message,
          );
        }

        const response: ApiResponse = {
          code: err.statusCode,
          success: false,
          message: err.message,
          data: null,
        };
        return c.json(response, err.statusCode as 400);
      }

      // 未知错误
      logger.error(
        { err, requestId: c.get("requestId") },
        "Unhandled error",
      );

      const message =
        env === "production" ? "Internal server error" : String(err);
      const response: ApiResponse = {
        code: 500,
        success: false,
        message,
        data: null,
      };
      return c.json(response, 500);
    }
  };
}
