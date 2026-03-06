/**
 * Cart Service — Hono app 入口 :3003
 * 购物车域：纯 Redis 存储，不操作 PG
 * 通过调用 product-service 内部接口获取 SKU 实时数据
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler, getConfig, createLogger } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { warmupRedis } from '@repo/database';
import cartRoutes from './routes/cart';
import internalRoutes from './routes/internal';

const config = getConfig();
const log = createLogger('cart-service');

// 连接预热状态
let ready = false;
(async () => {
  try {
    await warmupRedis();
    ready = true;
    log.info('Cart service ready');
  } catch (err) {
    log.fatal('Warmup failed', { error: (err as Error).message });
    process.exit(1);
  }
})();

const app = new Hono<AppEnv>();

// 全局中间件
app.use('*', requestId());
app.use('*', logger());
app.onError(errorHandler);

// 挂载路由
app.route('/api/v1/cart', cartRoutes);
app.route('/internal/cart', internalRoutes);

// 健康检查（GET + POST 双支持）
// 预热完成前返回 503，阻止 K8s/Docker 将流量路由到此 Pod
const cartHealth = (c: any) => {
  if (!ready) return c.json({ status: 'warming', service: 'cart-service' }, 503);
  return c.json({ status: 'ok', service: 'cart-service' });
};
app.get('/health', cartHealth);
app.post('/health', cartHealth);

export default {
  port: config.server.ports.cart,
  fetch: app.fetch,
};

// 导出 app 实例供测试使用
export { app };
