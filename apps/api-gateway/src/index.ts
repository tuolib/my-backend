import { serve } from "bun";
import { app } from "./app";

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 3000),
});

console.log("API Gateway running at http://localhost:3000");
