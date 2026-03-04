/**
 * API Gateway 入口
 * 唯一外部入口 :3000
 */
import { getConfig, createLogger } from '@repo/shared';
import { app } from './app';

const log = createLogger('api-gateway');
const config = getConfig();
const port = config.server.ports.gateway;

export default {
  port,
  fetch: app.fetch,
};

log.info('API Gateway started', { port });
