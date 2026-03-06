/**
 * API Gateway 入口
 * 唯一外部入口 :3000
 */
import { getConfig, createLogger } from '@repo/shared';
import { warmupDb, warmupRedis } from '@repo/database';
import { setGatewayReady } from './routes/health';
import { app } from './app';

const log = createLogger('api-gateway');
const config = getConfig();
const port = config.server.ports.gateway;

// 连接预热：确保 DB/Redis 连接在接收流量前已建立
// 预热完成前 /health/ready 返回 503，K8s 不会灌入流量
(async () => {
  try {
    await Promise.all([warmupDb(), warmupRedis()]);
    setGatewayReady(true);
    log.info('API Gateway ready (connections warmed up)');
  } catch (err) {
    log.fatal('Warmup failed', { error: (err as Error).message });
    process.exit(1);
  }
})();

export default {
  port,
  fetch: app.fetch,
};

log.info('API Gateway started', { port });
