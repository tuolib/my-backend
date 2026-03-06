/**
 * API Gateway 入口
 * 唯一外部入口 :3000
 */
import { getConfig, createLogger } from '@repo/shared';
import { warmupDb, warmupRedis } from '@repo/database';
import { app } from './app';

const log = createLogger('api-gateway');
const config = getConfig();
const port = config.server.ports.gateway;

// 连接预热：确保 DB/Redis 连接在接收流量前已建立
(async () => {
  try {
    await Promise.all([warmupDb(), warmupRedis()]);
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
