/**
 * API Gateway 入口
 * 唯一外部入口 :3000
 */
import { serve } from "bun";
import { getConfig } from "@repo/shared";
import { app } from "./app";

const config = getConfig();
const port = config.server.ports.gateway;

serve({
  fetch: app.fetch,
  port,
});

console.log(`API Gateway running at http://localhost:${port}`);
