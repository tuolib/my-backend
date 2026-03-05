/**
 * 内部路由 — /internal/order/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { success } from '@repo/shared';
import { db, orders } from '@repo/database';
import { eq, sql } from 'drizzle-orm';

const internal = new Hono<AppEnv>();

// POST /internal/order/user-stats — 获取用户订单统计（user-service 管理端使用）
internal.post('/user-stats', async (c) => {
  const { userId } = await c.req.json<{ userId: string }>();

  const [row] = await db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalPaid: sql<number>`count(*) filter (where ${orders.status} in ('paid','shipped','delivered','completed'))::int`,
      totalAmount: sql<string>`coalesce(sum(${orders.payAmount}) filter (where ${orders.status} in ('paid','shipped','delivered','completed')), 0)`,
    })
    .from(orders)
    .where(eq(orders.userId, userId));

  return c.json(success({
    totalOrders: row?.totalOrders ?? 0,
    totalPaid: row?.totalPaid ?? 0,
    totalAmount: row?.totalAmount ?? '0',
  }));
});

export default internal;
