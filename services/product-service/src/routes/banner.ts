/**
 * Banner 路由 — 首页轮播图
 * POST /api/v1/banner/list — 获取活跃的 banner 列表
 */
import { Hono } from 'hono';
import { success } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import { db, banners } from '@repo/database';
import { eq, asc, and, or, isNull, lte, gte } from 'drizzle-orm';

const app = new Hono<AppEnv>();

app.post('/list', async (c) => {
  const now = new Date();

  const rows = await db
    .select()
    .from(banners)
    .where(
      and(
        eq(banners.isActive, true),
        or(isNull(banners.startAt), lte(banners.startAt, now)),
        or(isNull(banners.endAt), gte(banners.endAt, now)),
      ),
    )
    .orderBy(asc(banners.sortOrder));

  return c.json(success(rows, c));
});

export default app;
