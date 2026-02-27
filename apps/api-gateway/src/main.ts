import { Hono } from 'hono';

const app = new Hono();

// 示例路由
app.get('/ping', (c) => c.text('pong'));

app.post('/orders', async (c) => {
  // 转发到 order-service
  const res = await fetch('http://localhost:3001/orders', {
    method: 'POST',
    body: await c.req.text(),
    headers: c.req.header(),
  });
  return new Response(res.body, res);
});

import { serve } from "bun"

serve({
  fetch: app.fetch,
  port: 3000,
})

console.log("API Gateway running at http://localhost:3000")

