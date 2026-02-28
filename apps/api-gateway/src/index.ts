/**
 * API Gateway 入口
 * 唯一外部入口 :3000
 */
import { getConfig } from '@repo/shared';
import { app } from './app';

const config = getConfig();
const port = config.server.ports.gateway;

export default {
  port,
  fetch: app.fetch,
};

console.log(`API Gateway running at http://localhost:${port}`);
