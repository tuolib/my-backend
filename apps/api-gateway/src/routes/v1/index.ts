import { Hono } from "hono";

const v1 = new Hono();

v1.get("/", (c) => c.json({ version: "v1" }));

// TODO: v1.route("/users", usersRoute)
// TODO: v1.route("/orders", ordersRoute)

export { v1 };
