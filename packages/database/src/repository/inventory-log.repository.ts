import { eq, and } from 'drizzle-orm';
import { inventoryLogs } from '../schema/inventory_logs';
import { BaseRepository, type QueryOptions } from './base.repository';
import type { PaginatedResult } from '@repo/shared/types';

type InventoryLogInsert = typeof inventoryLogs.$inferInsert;
type InventoryLogSelect = typeof inventoryLogs.$inferSelect;

export class InventoryLogRepository extends BaseRepository<typeof inventoryLogs, InventoryLogInsert, InventoryLogSelect> {
  constructor() {
    super(inventoryLogs, 'inventory_logs');
  }

  async findBySkuId(skuId: string, options: QueryOptions = {}): Promise<PaginatedResult<InventoryLogSelect>> {
    const skuFilter = eq(inventoryLogs.skuId, skuId);
    return this.findMany({
      ...options,
      where: options.where ? and(skuFilter, options.where) : skuFilter,
    });
  }
}
