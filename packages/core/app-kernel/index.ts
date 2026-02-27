import { Hono } from 'hono';
import type { AppEnv } from '@core/context';

/** 应用配置 */
export interface AppConfig {
  name: string;
  port: number;
  env: 'development' | 'production' | 'test';
}

/** 创建 Hono 应用实例并挂载全局错误处理 */
export function bootstrap(config: AppConfig) {
  const app = new Hono<AppEnv>();

  // 全局错误兜底 — 防止未捕获异常泄漏堆栈
  app.onError((err, c) => {
    const message = config.env === 'production' ? 'Internal server error' : err.message;
    return c.json({ code: 500, success: false, message, data: null }, 500);
  });

  return app;
}

/** 优雅关闭工具 */
export class GracefulShutdown {
  private callbacks: (() => Promise<void> | void)[] = [];

  /** 注册关闭回调 */
  register(cb: () => Promise<void> | void) {
    this.callbacks.push(cb);
  }

  /** 启动信号监听 */
  listen() {
    const handler = async () => {
      for (const cb of this.callbacks) {
        await cb();
      }
      process.exit(0);
    };

    process.on('SIGTERM', handler);
    process.on('SIGINT', handler);
  }
}
