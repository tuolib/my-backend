import { count, eq, isNull, sql, and, desc, asc, SQL } from 'drizzle-orm';
import type { PgTable, PgColumn, TableConfig } from 'drizzle-orm/pg-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PaginatedResult } from '@repo/shared/types';
import { OptimisticLockError } from '@repo/shared/errors';
import { getDb } from '../client';

// ────────────────────────────── Types ──────────────────────────────

export interface QueryOptions {
  where?: SQL;
  orderBy?: SQL;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

/** 提取表的列定义 */
type TableColumns<T extends PgTable> = T['_']['columns'];

// ────────────────────────────── BaseRepository ──────────────────────────────

export class BaseRepository<
  TTable extends PgTable,
  TInsert extends Record<string, unknown>,
  TSelect extends Record<string, unknown>,
> {
  constructor(
    protected readonly table: TTable,
    protected readonly tableName: string,
  ) {}

  protected get db() {
    return getDb();
  }

  /** 获取表的 id 列 */
  protected get idColumn(): PgColumn {
    return (this.table as any).id;
  }

  /** 获取表的 updatedAt 列 */
  protected get updatedAtColumn(): PgColumn {
    return (this.table as any).updatedAt;
  }

  async findById(id: string): Promise<TSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(eq(this.idColumn, id))
      .limit(1);
    return (rows[0] as TSelect) ?? null;
  }

  async findMany(options: QueryOptions = {}): Promise<PaginatedResult<TSelect>> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = options.where ? [options.where] : [];
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [dataQuery, countQuery] = await Promise.all([
      this.db
        .select()
        .from(this.table)
        .where(whereClause)
        .orderBy(options.orderBy ?? desc((this.table as any).createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(this.table)
        .where(whereClause),
    ]);

    return {
      items: dataQuery as TSelect[],
      total: countQuery[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  async create(data: TInsert): Promise<TSelect> {
    const rows = await this.db.insert(this.table).values(data as any).returning();
    return rows[0] as TSelect;
  }

  async createMany(data: TInsert[]): Promise<TSelect[]> {
    if (data.length === 0) return [];
    const rows = await this.db.insert(this.table).values(data as any).returning();
    return rows as TSelect[];
  }

  async update(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
    const updateData = { ...data, updatedAt: new Date() } as any;
    const rows = await this.db
      .update(this.table)
      .set(updateData)
      .where(eq(this.idColumn, id))
      .returning();
    return (rows[0] as TSelect) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(this.table)
      .where(eq(this.idColumn, id))
      .returning();
    return rows.length > 0;
  }

  async withTransaction<T>(fn: (tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }
}

// ────────────────────────────── SoftDeleteRepository ──────────────────────────────

export class SoftDeleteRepository<
  TTable extends PgTable,
  TInsert extends Record<string, unknown>,
  TSelect extends Record<string, unknown>,
> extends BaseRepository<TTable, TInsert, TSelect> {
  /** 获取 deletedAt 列 */
  protected get deletedAtColumn(): PgColumn {
    return (this.table as any).deletedAt;
  }

  /** 构建软删除过滤条件 */
  protected softDeleteFilter(includeDeleted = false): SQL | undefined {
    return includeDeleted ? undefined : isNull(this.deletedAtColumn);
  }

  override async findById(id: string, includeDeleted = false): Promise<TSelect | null> {
    const conditions: SQL[] = [eq(this.idColumn, id)];
    const sdFilter = this.softDeleteFilter(includeDeleted);
    if (sdFilter) conditions.push(sdFilter);

    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(...conditions))
      .limit(1);
    return (rows[0] as TSelect) ?? null;
  }

  override async findMany(options: QueryOptions = {}): Promise<PaginatedResult<TSelect>> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [];
    const sdFilter = this.softDeleteFilter(options.includeDeleted);
    if (sdFilter) conditions.push(sdFilter);
    if (options.where) conditions.push(options.where);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [dataQuery, countQuery] = await Promise.all([
      this.db
        .select()
        .from(this.table)
        .where(whereClause)
        .orderBy(options.orderBy ?? desc((this.table as any).createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ total: count() })
        .from(this.table)
        .where(whereClause),
    ]);

    return {
      items: dataQuery as TSelect[],
      total: countQuery[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  /** 软删除：设置 deleted_at */
  override async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .update(this.table)
      .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(this.idColumn, id), isNull(this.deletedAtColumn)))
      .returning();
    return rows.length > 0;
  }

  /** 恢复软删除记录 */
  async restore(id: string): Promise<TSelect | null> {
    const rows = await this.db
      .update(this.table)
      .set({ deletedAt: null, updatedAt: new Date() } as any)
      .where(eq(this.idColumn, id))
      .returning();
    return (rows[0] as TSelect) ?? null;
  }

  /** 物理删除 */
  async forceDelete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(this.table)
      .where(eq(this.idColumn, id))
      .returning();
    return rows.length > 0;
  }
}

// ────────────────────────────── VersionedRepository ──────────────────────────────

export class VersionedRepository<
  TTable extends PgTable,
  TInsert extends Record<string, unknown>,
  TSelect extends Record<string, unknown>,
> extends SoftDeleteRepository<TTable, TInsert, TSelect> {
  /** 获取 version 列 */
  protected get versionColumn(): PgColumn {
    return (this.table as any).version;
  }

  /** 乐观锁更新：WHERE id = ? AND version = ?，version + 1 */
  override async update(id: string, data: Partial<TInsert>, version?: number): Promise<TSelect | null> {
    if (version === undefined) {
      // 无版本号时退回普通更新
      return super.update(id, data);
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
      version: sql`${this.versionColumn} + 1`,
    } as any;

    const rows = await this.db
      .update(this.table)
      .set(updateData)
      .where(
        and(
          eq(this.idColumn, id),
          eq(this.versionColumn, version),
          isNull(this.deletedAtColumn),
        ),
      )
      .returning();

    if (rows.length === 0) {
      // 判断记录是否存在
      const exists = await this.findById(id);
      if (!exists) return null;
      throw new OptimisticLockError(this.tableName, id);
    }

    return rows[0] as TSelect;
  }
}
