/**
 * Product Service — Hono app 入口 :3002
 * 商品管理、分类、SKU、搜索、缓存、库存内部接口
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler, createLogger } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { redis, registerLuaScripts, warmupDb, warmupRedis } from '@repo/database';
import productRoutes from './routes/product';
import categoryRoutes from './routes/category';
import bannerRoutes from './routes/banner';
import adminProductRoutes from './routes/admin-product';
import adminCategoryRoutes from './routes/admin-category';
import adminStockRoutes from './routes/admin-stock';
import internalRoutes from './routes/internal';
import stockRoutes from './routes/stock';

const log = createLogger('product-service');

// 连接预热 + Lua 脚本注册（带重试）
// 健康检查在预热完成前返回 503，阻止流量进入
let ready = false;
async function initService(maxRetries = 10, delayMs = 3000): Promise<void> {
  // 先预热基础连接
  await Promise.all([warmupDb(), warmupRedis()]);

  // 注册 Lua 脚本
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await registerLuaScripts(redis);
      ready = true;
      log.info('Product service ready (Lua scripts registered)');
      return;
    } catch (err) {
      log.warn('Lua script registration failed', {
        attempt, maxRetries, error: (err as Error).message,
      });
      if (attempt === maxRetries) {
        throw new Error(`Failed to register Lua scripts after ${maxRetries} attempts`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
initService().catch((err) => {
  log.fatal('Product service init failed, process will exit', { error: (err as Error).message });
  process.exit(1);
});

const app = new Hono<AppEnv>();

// 全局中间件
app.use('*', requestId());
app.use('*', logger());
app.onError(errorHandler);

// 挂载路由
app.route('/api/v1/product', productRoutes);
app.route('/api/v1/category', categoryRoutes);
app.route('/api/v1/banner', bannerRoutes);
app.route('/api/v1/admin/product', adminProductRoutes);
app.route('/api/v1/admin/category', adminCategoryRoutes);
app.route('/api/v1/admin/stock', adminStockRoutes);
app.route('/internal/product', internalRoutes);
app.route('/internal/stock', stockRoutes);

// 健康检查（GET + POST 双支持）
// 预热完成前返回 503，阻止 K8s/Docker 将流量路由到此 Pod
const productHealth = (c: any) => {
  if (!ready) return c.json({ status: 'warming', service: 'product-service' }, 503);
  return c.json({ status: 'ok', service: 'product-service' });
};
app.get('/health', productHealth);
app.post('/health', productHealth);

export default {
  port: Number(process.env.PRODUCT_SERVICE_PORT) || 3002,
  fetch: app.fetch,
};

// 导出 app 实例供测试使用
export { app };
