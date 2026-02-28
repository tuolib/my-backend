import { eq, and, isNull } from 'drizzle-orm';
import { products } from '../schema/products';
import { VersionedRepository, type QueryOptions } from './base.repository';
import type { PaginatedResult } from '@repo/shared/types';

type ProductInsert = typeof products.$inferInsert;
type ProductSelect = typeof products.$inferSelect;

export class ProductRepository extends VersionedRepository<typeof products, ProductInsert, ProductSelect> {
  constructor() {
    super(products, 'products');
  }

  async findBySlug(slug: string): Promise<ProductSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(eq(products.slug, slug), isNull(products.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByCategoryId(categoryId: string, options: QueryOptions = {}): Promise<PaginatedResult<ProductSelect>> {
    return this.findMany({
      ...options,
      where: options.where
        ? and(eq(products.categoryId, categoryId), options.where)
        : eq(products.categoryId, categoryId),
    });
  }
}
