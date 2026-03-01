/**
 * 库存内部路由 — /internal/stock/*
 * 服务间调用（order-service → product-service），不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import {
  reserveSchema,
  releaseSchema,
  confirmSchema,
  syncSchema,
} from '../schemas/stock.schema';
import * as stockService from '../services/stock.service';

const stock = new Hono<AppEnv>();

// POST /internal/stock/reserve — 库存预扣（Redis Lua 原子操作）
stock.post('/reserve', validate(reserveSchema), async (c) => {
  const { items, orderId } = c.get('validated') as {
    items: Array<{ skuId: string; quantity: number }>;
    orderId: string;
  };

  if (items.length === 1) {
    await stockService.reserveSingle(items[0].skuId, items[0].quantity, orderId);
  } else {
    await stockService.reserveMulti(items, orderId);
  }

  return c.json(success(null));
});

// POST /internal/stock/release — 库存释放（订单取消/超时）
stock.post('/release', validate(releaseSchema), async (c) => {
  const { items, orderId } = c.get('validated') as {
    items: Array<{ skuId: string; quantity: number }>;
    orderId: string;
  };

  if (items.length === 1) {
    await stockService.releaseSingle(items[0].skuId, items[0].quantity, orderId);
  } else {
    await stockService.releaseMulti(items, orderId);
  }

  return c.json(success(null));
});

// POST /internal/stock/confirm — 库存确认（PG 乐观锁）
stock.post('/confirm', validate(confirmSchema), async (c) => {
  const { items, orderId } = c.get('validated') as {
    items: Array<{ skuId: string; quantity: number }>;
    orderId: string;
  };

  if (items.length === 1) {
    await stockService.confirmSingle(items[0].skuId, items[0].quantity, orderId);
  } else {
    await stockService.confirmMulti(items, orderId);
  }

  return c.json(success(null));
});

// POST /internal/stock/sync — Redis ↔ DB 库存同步
stock.post('/sync', validate(syncSchema), async (c) => {
  const { forceSync } = c.get('validated') as { forceSync: boolean };
  const report = await stockService.syncAll({ forceSync });
  return c.json(success(report));
});

export default stock;
