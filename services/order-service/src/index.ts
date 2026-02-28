import { Hono } from "hono";

const app = new Hono();

app.post("/health", (c) => c.json({ status: "ok", service: "order-service" }));

export default {
  port: 3004,
  fetch: app.fetch,
};
