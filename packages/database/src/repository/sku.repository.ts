import { eq, and, isNull, sql } from 'drizzle-orm';
import { skus } from '../schema/skus';
import { VersionedRepository } from './base.repository';

type SkuInsert = typeof skus.$inferInsert;
type SkuSelect = typeof skus.$inferSelect;

export class SkuRepository extends VersionedRepository<typeof skus, SkuInsert, SkuSelect> {
  constructor() {
    super(skus, 'skus');
  }

  async findByProductId(productId: string): Promise<SkuSelect[]> {
    return this.db
      .select()
      .from(this.table)
      .where(and(eq(skus.productId, productId), isNull(skus.deletedAt)));
  }

  async findBySkuCode(code: string): Promise<SkuSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(eq(skus.skuCode, code), isNull(skus.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 原子扣减库存，防止超卖
   * 使用 SQL: SET stock = stock - ? WHERE stock >= ? AND id = ?
   * @returns 更新后的 SKU，如果库存不足返回 null
   */
  async decrementStock(skuId: string, quantity: number): Promise<SkuSelect | null> {
    const rows = await this.db
      .update(this.table)
      .set({
        stock: sql`${skus.stock} - ${quantity}`,
        version: sql`${skus.version} + 1`,
        updatedAt: new Date(),
      } as any)
      .where(
        and(
          eq(skus.id, skuId),
          sql`${skus.stock} >= ${quantity}`,
          isNull(skus.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
