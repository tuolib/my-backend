/**
 * Order Service 入口
 * 端口 :3004 — 订单创建、查询、取消、管理端操作
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler, getConfig } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import orderRoutes from './routes/order';
import paymentRoutes from './routes/payment';
import adminRoutes from './routes/admin';
import internalRoutes from './routes/internal';

const config = getConfig();
const app = new Hono<AppEnv>();

// ── 全局中间件 ──
app.use('*', requestId());
app.use('*', logger());
app.onError(errorHandler);

// ── 路由挂载 ──
app.route('/api/v1/order', orderRoutes);
app.route('/api/v1/payment', paymentRoutes);
app.route('/api/v1/admin/order', adminRoutes);
app.route('/internal/order', internalRoutes);

// ── 健康检查 ──
app.post('/health', (c) => c.json({ status: 'ok', service: 'order-service' }));

export default {
  port: config.server.ports.order,
  fetch: app.fetch,
};

export { app };
