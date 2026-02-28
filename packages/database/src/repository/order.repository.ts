import { eq, and, isNull } from 'drizzle-orm';
import { orders } from '../schema/orders';
import { VersionedRepository, type QueryOptions } from './base.repository';
import type { PaginatedResult } from '@repo/shared/types';

type OrderInsert = typeof orders.$inferInsert;
type OrderSelect = typeof orders.$inferSelect;

export class OrderRepository extends VersionedRepository<typeof orders, OrderInsert, OrderSelect> {
  constructor() {
    super(orders, 'orders');
  }

  async findByOrderNo(orderNo: string): Promise<OrderSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(eq(orders.orderNo, orderNo), isNull(orders.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByUserId(userId: string, options: QueryOptions = {}): Promise<PaginatedResult<OrderSelect>> {
    return this.findMany({
      ...options,
      where: options.where
        ? and(eq(orders.userId, userId), options.where)
        : eq(orders.userId, userId),
    });
  }
}
