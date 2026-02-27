import { Hono } from 'hono';
import { listOrders } from '../application/order.usecase';
import { getCache, setCache } from '@cache';

const app = new Hono();

// 获取订单列表
app.get('/orders', async (c) => {
  const cacheKey = 'orders:list';
  const cached = await getCache().get(cacheKey);
  if (cached) {
    return c.json(JSON.parse(cached));
  }

  const orders = await listOrders();
  await getCache().set(cacheKey, JSON.stringify(orders));

  return c.json(orders);
});

// 创建新订单
app.post('/orders', async (c) => {
  const cmd = await c.req.json();
  // 简单逻辑：存数据库
  const db = (await import('@database')).getDb();
  const result = await db.query('INSERT INTO orders(item, qty) VALUES($1, $2) RETURNING *', [
    cmd.item,
    cmd.qty,
  ]);
  // 可选：更新缓存
  await getCache().set('orders:list', JSON.stringify([result.rows[0]]));
  return c.json({ success: true, order: result.rows[0] });
});

export default app;
