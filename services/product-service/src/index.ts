import { Hono } from "hono";

const app = new Hono();

app.post("/health", (c) => c.json({ status: "ok", service: "product-service" }));

export default {
  port: 3002,
  fetch: app.fetch,
};
