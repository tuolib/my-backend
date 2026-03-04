/**
 * Product Service — Hono app 入口 :3002
 * 商品管理、分类、SKU、搜索、缓存、库存内部接口
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { redis, registerLuaScripts } from '@repo/database';
import productRoutes from './routes/product';
import categoryRoutes from './routes/category';
import adminProductRoutes from './routes/admin-product';
import adminCategoryRoutes from './routes/admin-category';
import adminStockRoutes from './routes/admin-stock';
import internalRoutes from './routes/internal';
import stockRoutes from './routes/stock';

// 启动时注册 Lua 脚本（带重试，等待 Redis 就绪）
// 注意：不阻塞 HTTP 服务启动，确保启动探针可达
let luaReady = false;
async function initLuaScripts(maxRetries = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await redis.ping();
      await registerLuaScripts(redis);
      luaReady = true;
      console.log('[INIT] Lua scripts registered');
      return;
    } catch (err) {
      console.warn(`[INIT] Lua script registration failed (attempt ${attempt}/${maxRetries}):`, (err as Error).message);
      if (attempt === maxRetries) {
        throw new Error(`Failed to register Lua scripts after ${maxRetries} attempts`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
// 后台初始化，不阻塞 HTTP 服务器启动
initLuaScripts().catch((err) => {
  console.error('[FATAL] Lua script init failed, process will exit:', err);
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
app.route('/api/v1/admin/product', adminProductRoutes);
app.route('/api/v1/admin/category', adminCategoryRoutes);
app.route('/api/v1/admin/stock', adminStockRoutes);
app.route('/internal/product', internalRoutes);
app.route('/internal/stock', stockRoutes);

// 健康检查（GET + POST 双支持）
const productHealth = (c: any) => c.json({ status: 'ok', service: 'product-service' });
app.get('/health', productHealth);
app.post('/health', productHealth);

export default {
  port: Number(process.env.PRODUCT_SERVICE_PORT) || 3002,
  fetch: app.fetch,
};

// 导出 app 实例供测试使用
export { app };
