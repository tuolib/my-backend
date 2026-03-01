/**
 * 内部路由 — /internal/cart/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { clearItemsSchema } from '../schemas/cart.schema';
import * as cartService from '../services/cart.service';
import type { ClearItemsInput } from '../types';

const internal = new Hono<AppEnv>();

// POST /internal/cart/clear-items — 订单创建后清理已下单的 SKU
internal.post('/clear-items', validate(clearItemsSchema), async (c) => {
  const { userId, skuIds } = c.get('validated') as ClearItemsInput;
  await cartService.clearItems(userId, skuIds);
  return c.json(success(null, '已清理'));
});

export default internal;
