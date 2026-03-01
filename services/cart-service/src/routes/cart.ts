/**
 * 购物车公开路由 — /api/v1/cart/*
 * 全部需要 JWT 认证
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import {
  addCartSchema,
  updateCartSchema,
  removeCartSchema,
  selectCartSchema,
} from '../schemas/cart.schema';
import { authMiddleware } from '../middleware';
import * as cartService from '../services/cart.service';
import type { AddCartInput, UpdateCartInput, RemoveCartInput, SelectCartInput } from '../types';

const cart = new Hono<AppEnv>();

// 全部路由需要认证
cart.use('/*', authMiddleware);

// POST /api/v1/cart/add — 添加商品到购物车
cart.post('/add', validate(addCartSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.get('validated') as AddCartInput;
  await cartService.add(userId, input);
  return c.json(success(null, '已加入购物车'));
});

// POST /api/v1/cart/list — 获取购物车列表
cart.post('/list', async (c) => {
  const userId = c.get('userId');
  const items = await cartService.list(userId);
  return c.json(success(items));
});

// POST /api/v1/cart/update — 更新商品数量
cart.post('/update', validate(updateCartSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.get('validated') as UpdateCartInput;
  await cartService.update(userId, input);
  return c.json(success(null, '已更新'));
});

// POST /api/v1/cart/remove — 批量删除商品
cart.post('/remove', validate(removeCartSchema), async (c) => {
  const userId = c.get('userId');
  const { skuIds } = c.get('validated') as RemoveCartInput;
  await cartService.remove(userId, skuIds);
  return c.json(success(null, '已移除'));
});

// POST /api/v1/cart/clear — 清空购物车
cart.post('/clear', async (c) => {
  const userId = c.get('userId');
  await cartService.clear(userId);
  return c.json(success(null, '购物车已清空'));
});

// POST /api/v1/cart/select — 选择/取消选择商品
cart.post('/select', validate(selectCartSchema), async (c) => {
  const userId = c.get('userId');
  const { skuIds, selected } = c.get('validated') as SelectCartInput;
  await cartService.select(userId, skuIds, selected);
  return c.json(success(null));
});

// POST /api/v1/cart/checkout/preview — 结算预览
cart.post('/checkout/preview', async (c) => {
  const userId = c.get('userId');
  const preview = await cartService.checkoutPreview(userId);
  return c.json(success(preview));
});

export default cart;
