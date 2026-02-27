import { serve } from "bun";
import { setDatabase } from "@database";
import { setCache } from "@cache";

// 绑定 infra
import { query } from "../../../infra/postgres/client";
import { getRedis, setRedis } from "../../../infra/redis/client";

setDatabase({ query });
setCache({ get: getRedis, set: setRedis });

// 启动 HTTP server
const { default: app } = await import("./api/order.controller");

serve({
  fetch: app.fetch,
  port: 3001,
});

console.log("Order-service running at http://localhost:3001");
