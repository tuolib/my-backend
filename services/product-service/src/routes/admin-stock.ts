/**
 * 管理员库存调整路由 — /api/v1/admin/stock/*
 * 需要认证，管理员手动调整库存
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { adjustSchema } from '../schemas/stock.schema';
import { authMiddleware } from '../middleware';
import * as stockService from '../services/stock.service';

const adminStock = new Hono<AppEnv>();

adminStock.use('/*', authMiddleware);

// POST /api/v1/admin/stock/adjust — 管理员调整库存
adminStock.post('/adjust', validate(adjustSchema), async (c) => {
  const { skuId, quantity, reason } = c.get('validated') as {
    skuId: string;
    quantity: number;
    reason?: string;
  };
  await stockService.adjust(skuId, quantity, reason);
  return c.json(success(null));
});

export default adminStock;
