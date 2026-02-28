/**
 * 订单数据访问层 — orders 表操作
 * 包含乐观锁更新、幂等查询、分页列表
 */
import { eq, and, desc, count, lt, sql } from 'drizzle-orm';
import { db, orders } from '@repo/database';
import type { Order, NewOrder } from '@repo/database';
import { OrderStatus } from '../state-machine/order-status';

/** 按 ID 查找订单 */
export async function findById(id: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row ?? null;
}

/** 按订单号查找 */
export async function findByOrderNo(orderNo: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.orderNo, orderNo));
  return row ?? null;
}

/** 按幂等键查找（用于重复提交检查） */
export async function findByIdempotencyKey(key: string): Promise<Order | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, key));
  return row ?? null;
}

/** 按用户 ID 分页查询订单列表 */
export async function findByUserId(params: {
  userId: string;
  page: number;
  pageSize: number;
  status?: string;
}): Promise<{ items: Order[]; total: number }> {
  const { userId, page, pageSize, status } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(orders.userId, userId)];
  if (status) {
    conditions.push(eq(orders.status, status));
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [items, [totalRow]] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(orders)
      .where(where),
  ]);

  return { items, total: totalRow?.value ?? 0 };
}

/** 管理端分页查询（不限用户） */
export async function findAll(params: {
  page: number;
  pageSize: number;
  status?: string;
}): Promise<{ items: Order[]; total: number }> {
  const { page, pageSize, status } = params;
  const offset = (page - 1) * pageSize;

  const where = status ? eq(orders.status, status) : undefined;

  const [items, [totalRow]] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(orders)
      .where(where),
  ]);

  return { items, total: totalRow?.value ?? 0 };
}

/** 创建订单 */
export async function create(data: NewOrder): Promise<Order> {
  const [row] = await db.insert(orders).values(data).returning();
  return row;
}

/**
 * 乐观锁更新订单状态
 * WHERE id = :id AND version = :currentVersion
 * 返回是否更新成功
 */
export async function updateStatus(
  id: string,
  newStatus: OrderStatus,
  currentVersion: number,
  extra?: Partial<Pick<Order, 'paymentMethod' | 'paymentNo' | 'paidAt' | 'shippedAt' | 'deliveredAt' | 'completedAt' | 'cancelledAt' | 'cancelReason'>>,
): Promise<boolean> {
  const result = await db
    .update(orders)
    .set({
      status: newStatus,
      version: currentVersion + 1,
      updatedAt: new Date(),
      ...extra,
    })
    .where(and(eq(orders.id, id), eq(orders.version, currentVersion)));

  return (result as any).rowCount > 0 || (result as any).count > 0;
}

/** 查找超时未支付的 pending 订单 */
export async function findExpiredPending(limit: number): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, OrderStatus.PENDING),
        lt(orders.expiresAt, new Date()),
      ),
    )
    .limit(limit);
}
