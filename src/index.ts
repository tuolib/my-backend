import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { globalErrorHandler, ApiResult } from '@/utils/response.ts';
import { checkRedisReadiness, connectRedis } from '@/lib/redis.ts';
import { checkDatabaseReadiness } from '@/db';
import { buildRouter } from '@/router.ts';

const app = new Hono();

// 全局中间件
app.use('*', cors());
app.onError(globalErrorHandler);

// 挂载所有业务路由
app.route('/', buildRouter());

// 基础路由
app.get('/', (c) => c.text('API is running!'));
app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.get('/readyz', async (c) => {
  try {
    await checkDatabaseReadiness();
    await checkRedisReadiness();
    return c.json({ status: 'ready' });
  } catch (error) {
    return c.json(
      {
        status: 'not-ready',
        reason: error instanceof Error ? error.message : 'unknown',
      },
      503
    );
  }
});
app.notFound((c) => ApiResult.error(c, '请求资源不存在', 404));

// 服务初始化
const initializeServices = async () => {
  try {
    await connectRedis();
    await checkDatabaseReadiness();
  } catch (error) {
    console.error('❌ 服务初始化失败:', error);
    process.exit(1);
  }
};

const startServer = async () => {
  await initializeServices();
  console.log('✅ 服务初始化成功');
  return {
    port: 3000,
    fetch: app.fetch,
  };
};

export default await startServer();
