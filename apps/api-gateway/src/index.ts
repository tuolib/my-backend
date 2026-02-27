import { serve } from "bun";
import { loadEnv, createRuntimeConfig } from "@repo/shared/config";
import { initDatabase } from "@repo/database";
import { app } from "./app";

const env = loadEnv();
const config = createRuntimeConfig(env);

initDatabase(config.database);

serve({
  fetch: app.fetch,
  port: config.server.port,
});

console.log(`API Gateway running at http://localhost:${config.server.port}`);
