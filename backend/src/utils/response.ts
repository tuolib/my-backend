import type { Context, Env, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

// --- 1. 统一接口定义 ---
export type ApiResponse<T = any> = {
  code: number;
  success: boolean;
  message: string;
  data: T;
};

// --- 2. 响应工具类 ---
export const ApiResult = {
  /**
   * 成功返回
   */
  success: <T>(c: Context, data: T = null as any, message = "操作成功"): ApiResponse<T> => {
    const response: ApiResponse<T> = {
      code: 200,
      success: true,
      message,
      data,
    };
    return c.json(response, 200) as any;
  },

  /**
   * 失败返回 (手动调用)
   */
  error: (c: Context, message = "操作失败", code = 400, data: any = null): ApiResponse => {
    const response: ApiResponse = {
      code,
      success: false,
      message,
      data,
    };
    return c.json(response, code as any) as any;
  }
};

// --- 3. 全局异常处理器 (用于 app.onError) ---
export const globalErrorHandler: ErrorHandler = (err, c) => {
  let code = 500;
  let message = "服务器内部错误";

  // 处理 Hono 自带的 HTTP 异常 (如 404, 401)
  if (err instanceof HTTPException) {
    code = err.status;
    message = err.message;
  }
  // 如果是普通的 Error 对象
  else if (err instanceof Error) {
    message = err.message;
  }

  console.error(`[API Error] ${c.req.method} ${c.req.url}:`, err);

  return c.json({
    code,
    success: false,
    message,
    data: null,
  }, code as any);
};

// --- 4. Zod 校验错误适配器 ---
// 用于 zValidator 的第三个参数 (Hook)
export const onZodError = (result: any, c: Context) => {
  if (!result.success) {
    const error = result.error as z.ZodError;
    // const message = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    const message = error.issues.map(i => `${i.message}`).join('; ');

    return c.json({
      code: 400,
      success: false,
      message: `${message}`,
      data: null,
    }, 400);
  }
};