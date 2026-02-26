import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { globalErrorHandler, ApiResult } from '@/utils/response.ts';
import { checkRedisReadiness, connectRedis } from '@/lib/redis.ts';
import { checkDatabaseReadiness } from '@/db';
import { buildRouter } from '@/router.ts';
import {
  gatewayRoutes,
  gatewayRateLimitMiddleware,
  gatewayAuthMiddleware,
  gatewayProxyMiddleware,
} from '@/gateway/index.ts';
import { logger } from '@/lib/logger.ts';

const app = new Hono();
const port = Number(process.env.PORT || 3000);

// 全局中间件
app.use('*', cors());
app.onError(globalErrorHandler);

// 网关系统路由（/health, /ready — 无需认证/限流）
app.route('/', gatewayRoutes);

// 网关中间件（stub，默认全部 pass-through，零行为变更）
app.use('*', gatewayRateLimitMiddleware);
app.use('*', gatewayAuthMiddleware);
app.use('*', gatewayProxyMiddleware);

// 挂载所有业务路由（含 request-id 中间件）
app.route('/', buildRouter());

// 系统路由（不含业务逻辑，不需要 request-id）
app.get('/', (c) => c.text('API is running!'));
app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.get('/readyz', async (c) => {
  try {
    await checkDatabaseReadiness();
    await checkRedisReadiness();
    return c.json({ status: 'ready' });
  } catch (error) {
    return c.json(
      { status: 'not-ready', reason: error instanceof Error ? error.message : 'unknown' },
      503
    );
  }
});
app.notFound((c) => ApiResult.error(c, '请求资源不存在', 404));

const initializeServices = async () => {
  try {
    await connectRedis();
    await checkDatabaseReadiness();
  } catch (error) {
    logger.error('Service initialization failed', { error: String(error) });
    process.exit(1);
  }
};

const startServer = async () => {
  await initializeServices();
  logger.info('Service initialized successfully', { port, host: '0.0.0.0' });
  return { hostname: '0.0.0.0', port, fetch: app.fetch };
};

export default await startServer();
