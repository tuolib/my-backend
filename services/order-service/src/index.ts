/**
 * Order Service 入口
 * 端口 :3004 — 订单创建、查询、取消、支付、管理端操作
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler, getConfig } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import orderRoutes from './routes/order';
import paymentRoutes from './routes/payment';
import adminRoutes from './routes/admin';
import dashboardRoutes from './routes/dashboard';
import internalRoutes from './routes/internal';
import { OrderTimeoutChecker } from './services/timeout.service';

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
app.route('/api/v1/admin/dashboard', dashboardRoutes);
app.route('/internal/order', internalRoutes);

// ── 健康检查（GET + POST 双支持）──
const orderHealth = (c: any) => c.json({ status: 'ok', service: 'order-service' });
app.get('/health', orderHealth);
app.post('/health', orderHealth);

// ── 超时自动取消定时任务 ──
const timeoutChecker = new OrderTimeoutChecker();

// 仅在非测试环境启动定时任务（测试中手动控制）
if (config.server.env !== 'test') {
  timeoutChecker.start();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  timeoutChecker.stop();
  process.exit(0);
});

export default {
  port: config.server.ports.order,
  fetch: app.fetch,
};

export { app, timeoutChecker };
