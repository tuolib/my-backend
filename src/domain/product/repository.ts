import { eq, ilike, sql, and, type SQL } from "drizzle-orm";
import { db } from "../../shared/db";
import { products } from "./schema";
import type { CreateProductDto, UpdateProductDto, ProductQuery } from "./types";

export const productRepository = {
  async findAll(query: ProductQuery) {
    const conditions: SQL[] = [];
    if (query.search) {
      conditions.push(ilike(products.name, `%${query.search}%`));
    }
    if (query.categoryId) {
      conditions.push(eq(products.categoryId, query.categoryId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.limit;

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(products)
        .where(where)
        .limit(query.limit)
        .offset(offset)
        .orderBy(products.createdAt),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(where),
    ]);

    return { items, total: countResult[0].count };
  },

  async findById(id: string) {
    const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findBySlug(slug: string) {
    const rows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  async create(data: CreateProductDto & { slug: string }) {
    const rows = await db.insert(products).values(data).returning();
    return rows[0];
  },

  async update(id: string, data: UpdateProductDto) {
    const rows = await db
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return rows[0] ?? null;
  },

  async delete(id: string) {
    const rows = await db.delete(products).where(eq(products.id, id)).returning();
    return rows[0] ?? null;
  },
};
