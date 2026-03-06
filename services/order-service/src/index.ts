/**
 * Order Service 入口
 * 端口 :3004 — 订单创建、查询、取消、支付、管理端操作
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler, getConfig, createLogger } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { warmupDb, warmupRedis } from '@repo/database';
import orderRoutes from './routes/order';
import paymentRoutes from './routes/payment';
import adminRoutes from './routes/admin';
import dashboardRoutes from './routes/dashboard';
import internalRoutes from './routes/internal';
import { OrderTimeoutChecker } from './services/timeout.service';

const config = getConfig();
const log = createLogger('order-service');

// 连接预热状态
let ready = false;
(async () => {
  try {
    await Promise.all([warmupDb(), warmupRedis()]);
    ready = true;
    log.info('Order service ready');
  } catch (err) {
    log.fatal('Warmup failed', { error: (err as Error).message });
    process.exit(1);
  }
})();

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
// 预热完成前返回 503，阻止 K8s/Docker 将流量路由到此 Pod
const orderHealth = (c: any) => {
  if (!ready) return c.json({ status: 'warming', service: 'order-service' }, 503);
  return c.json({ status: 'ok', service: 'order-service' });
};
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
