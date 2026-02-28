import { Hono } from "hono";

const app = new Hono();

app.post("/health", (c) => c.json({ status: "ok", service: "cart-service" }));

export default {
  port: 3003,
  fetch: app.fetch,
};
