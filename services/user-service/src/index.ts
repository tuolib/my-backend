import { Hono } from "hono";

const app = new Hono();

app.post("/health", (c) => c.json({ status: "ok", service: "user-service" }));

export default {
  port: 3001,
  fetch: app.fetch,
};
