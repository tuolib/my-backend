/**
 * 订单商品数据访问层 — order_items 表操作
 */
import { eq } from 'drizzle-orm';
import { db, orderItems } from '@repo/database';
import type { OrderItem, NewOrderItem } from '@repo/database';

/** 批量创建订单商品 */
export async function createMany(items: NewOrderItem[]): Promise<OrderItem[]> {
  if (items.length === 0) return [];
  return db.insert(orderItems).values(items).returning();
}

/** 按订单 ID 查找所有商品 */
export async function findByOrderId(orderId: string): Promise<OrderItem[]> {
  return db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
}
