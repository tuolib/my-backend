/**
 * Refresh Token 数据访问层 — refresh_tokens 表操作
 */
import { eq, isNull, and } from 'drizzle-orm';
import { db, refreshTokens } from '@repo/database';
import type { RefreshToken } from '@repo/database';
import { generateId } from '@repo/shared';

/** 创建 refresh token 记录 */
export async function create(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<RefreshToken> {
  const [row] = await db
    .insert(refreshTokens)
    .values({
      id: generateId(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    })
    .returning();
  return row;
}

/** 按 token hash 查找（未撤销的） */
export async function findByHash(tokenHash: string): Promise<RefreshToken | null> {
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));
  return row ?? null;
}

/** 撤销单个 token */
export async function revoke(id: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, id));
}

/** 撤销用户的所有 token */
export async function revokeAllByUser(userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
