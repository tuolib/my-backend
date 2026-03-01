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

// 启动时注册 Lua 脚本
await registerLuaScripts(redis);
console.log('[INIT] Lua scripts registered');

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

// 健康检查
app.post('/health', (c) => c.json({ status: 'ok', service: 'product-service' }));

export default {
  port: Number(process.env.PRODUCT_SERVICE_PORT) || 3002,
  fetch: app.fetch,
};

// 导出 app 实例供测试使用
export { app };
