import { dbRead, dbWrite } from '@/db';
import { users } from '@/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { cache } from '@/lib/cache.ts';

export type NewUserPayload = { email: string; passwordHash: string };
export type UpdateUserPayload = Partial<{
  email: string;
  passwordHash: string;
  isActive: boolean;
}>;

// 缓存 TTL 常量（秒）
const CACHE_TTL_LIST = 30;    // 列表：短 TTL，依赖过期自然失效
const CACHE_TTL_USER = 300;   // 个体：5 分钟，写操作时主动失效

const listCacheKey = (page: number, pageSize: number) =>
  `cache:users:list:${page}:${pageSize}`;
const userCacheKey = (id: number) => `cache:users:id:${id}`;
// 用于列表缓存的批量失效（写操作后调用）
const LIST_CACHE_PATTERN = 'cache:users:list:*';

export const UserRepository = {
  /**
   * 分页查询（带 Redis 缓存）。
   * 选用 offset 分页：简单、UI 友好；数据量超千万时可迁移至 cursor 分页。
   * 列表缓存 TTL = 30s，写操作后通过 SCAN+DEL 主动失效。
   */
  async findPaginated(page: number, pageSize: number) {
    const cacheKey = listCacheKey(page, pageSize);
    const cached = await cache.get<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * pageSize;
    const [rows, countResult] = await Promise.all([
      dbRead.select().from(users).limit(pageSize).offset(offset),
      dbRead.select({ count: sql<number>`count(*)::int` }).from(users),
    ]);

    const total = countResult[0]?.count ?? 0;
    const result = { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    await cache.set(cacheKey, result, CACHE_TTL_LIST);
    return result;
  },

  async findById(id: number) {
    const cacheKey = userCacheKey(id);
    const cached = await cache.get<typeof users.$inferSelect>(cacheKey);
    if (cached) return cached;

    const [user] = await dbRead.select().from(users).where(eq(users.id, id));
    if (user) await cache.set(cacheKey, user, CACHE_TTL_USER);
    return user;
  },

  // findByEmail 不缓存：认证关键路径，必须读取最新数据（isActive 状态）
  async findByEmail(email: string) {
    const [user] = await dbRead.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  },

  async create(payload: NewUserPayload) {
    const [newUser] = await dbWrite
      .insert(users)
      .values(payload)
      .returning({ id: users.id, email: users.email, createdAt: users.createdAt });
    // 列表新增一条，所有分页缓存失效
    await cache.delByPattern(LIST_CACHE_PATTERN);
    return newUser;
  },

  async update(id: number, payload: UpdateUserPayload) {
    const [updatedUser] = await dbWrite
      .update(users)
      .set(payload)
      .where(eq(users.id, id))
      .returning();
    // 个体缓存 + 所有列表缓存失效
    await Promise.all([
      cache.del(userCacheKey(id)),
      cache.delByPattern(LIST_CACHE_PATTERN),
    ]);
    return updatedUser;
  },

  async delete(id: number) {
    const [deletedUser] = await dbWrite.delete(users).where(eq(users.id, id)).returning();
    await Promise.all([
      cache.del(userCacheKey(id)),
      cache.delByPattern(LIST_CACHE_PATTERN),
    ]);
    return deletedUser;
  },

  async updateLastLoginAt(id: number) {
    await dbWrite.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  },
};
