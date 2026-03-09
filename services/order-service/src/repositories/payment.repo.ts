/**
 * 支付记录数据访问层 — payment_records 表操作
 */
import { eq } from 'drizzle-orm';
import { db, dbRead, paymentRecords } from '@repo/database';
import type { PaymentRecord, NewPaymentRecord } from '@repo/database';

/** 按订单 ID 查找支付记录（走从库） */
export async function findByOrderId(orderId: string): Promise<PaymentRecord[]> {
  return dbRead
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.orderId, orderId));
}

/** 按三方交易 ID 查找（幂等检查） */
export async function findByTransactionId(transactionId: string): Promise<PaymentRecord | null> {
  const [row] = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.transactionId, transactionId));
  return row ?? null;
}

/** 创建支付记录 */
export async function create(data: NewPaymentRecord): Promise<PaymentRecord> {
  const [row] = await db.insert(paymentRecords).values(data).returning();
  return row;
}

/** 更新支付记录状态 */
export async function updateStatus(
  id: string,
  status: string,
  extra?: Partial<Pick<PaymentRecord, 'transactionId' | 'rawNotify'>>,
): Promise<void> {
  await db
    .update(paymentRecords)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(paymentRecords.id, id));
}
