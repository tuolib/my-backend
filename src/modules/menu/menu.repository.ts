import { dbRead, dbWrite } from '@/db';
import { restaurants, menuItems } from '@/db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { cache } from '@/lib/cache.ts';
import type { CreateRestaurantInput, CreateMenuItemInput, UpdateMenuItemInput } from './menu.schema.ts';

const CACHE_TTL_LIST = 30;
const CACHE_TTL_ITEM = 300;

const restaurantListKey = (page: number, pageSize: number) =>
  `cache:restaurants:list:${page}:${pageSize}`;
const restaurantKey = (id: number) => `cache:restaurants:id:${id}`;
const RESTAURANT_LIST_PATTERN = 'cache:restaurants:list:*';

const menuListKey = (restaurantId: number, page: number, pageSize: number) =>
  `cache:menu:list:${restaurantId}:${page}:${pageSize}`;
const menuItemKey = (id: number) => `cache:menu:item:${id}`;
const menuListPattern = (restaurantId: number) => `cache:menu:list:${restaurantId}:*`;

// ── 饭店 ────────────────────────────────────────────────────────────

export const RestaurantRepository = {
  async findPaginated(page: number, pageSize: number) {
    const cacheKey = restaurantListKey(page, pageSize);
    const cached = await cache.get<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * pageSize;
    const [rows, countResult] = await Promise.all([
      dbRead.select().from(restaurants).where(eq(restaurants.isActive, true)).limit(pageSize).offset(offset),
      dbRead.select({ count: sql<number>`count(*)::int` }).from(restaurants).where(eq(restaurants.isActive, true)),
    ]);

    const total = countResult[0]?.count ?? 0;
    const result = { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    await cache.set(cacheKey, result, CACHE_TTL_LIST);
    return result;
  },

  async findById(id: number) {
    const cacheKey = restaurantKey(id);
    const cached = await cache.get<typeof restaurants.$inferSelect>(cacheKey);
    if (cached) return cached;

    const [row] = await dbRead.select().from(restaurants).where(eq(restaurants.id, id));
    if (row) await cache.set(cacheKey, row, CACHE_TTL_ITEM);
    return row;
  },

  async create(data: CreateRestaurantInput) {
    const [row] = await dbWrite.insert(restaurants).values(data).returning();
    await cache.delByPattern(RESTAURANT_LIST_PATTERN);
    return row;
  },
};

// ── 菜单项 ──────────────────────────────────────────────────────────

export const MenuItemRepository = {
  async findByRestaurant(restaurantId: number, page: number, pageSize: number) {
    const cacheKey = menuListKey(restaurantId, page, pageSize);
    const cached = await cache.get<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * pageSize;
    const [rows, countResult] = await Promise.all([
      dbRead
        .select()
        .from(menuItems)
        .where(eq(menuItems.restaurantId, restaurantId))
        .limit(pageSize)
        .offset(offset),
      dbRead
        .select({ count: sql<number>`count(*)::int` })
        .from(menuItems)
        .where(eq(menuItems.restaurantId, restaurantId)),
    ]);

    const total = countResult[0]?.count ?? 0;
    const result = { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    await cache.set(cacheKey, result, CACHE_TTL_LIST);
    return result;
  },

  async findById(id: number) {
    const cacheKey = menuItemKey(id);
    const cached = await cache.get<typeof menuItems.$inferSelect>(cacheKey);
    if (cached) return cached;

    const [row] = await dbRead.select().from(menuItems).where(eq(menuItems.id, id));
    if (row) await cache.set(cacheKey, row, CACHE_TTL_ITEM);
    return row;
  },

  async findByIds(ids: number[]) {
    if (ids.length === 0) return [];
    return dbRead.select().from(menuItems).where(sql`${menuItems.id} = ANY(${ids})`);
  },

  async create(data: CreateMenuItemInput) {
    const [row] = await dbWrite
      .insert(menuItems)
      .values({ ...data, price: String(data.price) })
      .returning();
    await cache.delByPattern(menuListPattern(data.restaurantId));
    return row;
  },

  async update(id: number, data: Omit<UpdateMenuItemInput, 'id'>) {
    const payload: Record<string, unknown> = { ...data };
    if (data.price !== undefined) payload.price = String(data.price);

    const [row] = await dbWrite.update(menuItems).set(payload).where(eq(menuItems.id, id)).returning();
    if (row) {
      await Promise.all([
        cache.del(menuItemKey(id)),
        cache.delByPattern(menuListPattern(row.restaurantId)),
      ]);
    }
    return row;
  },

  async delete(id: number) {
    const [row] = await dbWrite.delete(menuItems).where(eq(menuItems.id, id)).returning();
    if (row) {
      await Promise.all([
        cache.del(menuItemKey(id)),
        cache.delByPattern(menuListPattern(row.restaurantId)),
      ]);
    }
    return row;
  },
};
