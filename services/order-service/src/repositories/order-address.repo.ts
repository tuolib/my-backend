/**
 * 订单地址数据访问层 — order_addresses 表操作
 * 存储地址快照，不 FK 到 user_addresses
 */
import { eq } from 'drizzle-orm';
import { db, orderAddresses } from '@repo/database';
import type { OrderAddress, NewOrderAddress } from '@repo/database';

/** 创建订单地址快照 */
export async function create(data: NewOrderAddress): Promise<OrderAddress> {
  const [row] = await db.insert(orderAddresses).values(data).returning();
  return row;
}

/** 按订单 ID 查找地址 */
export async function findByOrderId(orderId: string): Promise<OrderAddress | null> {
  const [row] = await db
    .select()
    .from(orderAddresses)
    .where(eq(orderAddresses.orderId, orderId));
  return row ?? null;
}
