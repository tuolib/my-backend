import { Hono } from "hono";
import { health } from "./routes/health";
import { v1 } from "./routes/v1";

const app = new Hono();

// 健康检查
app.route("/", health);

// API v1
app.route("/api/v1", v1);

export { app };
