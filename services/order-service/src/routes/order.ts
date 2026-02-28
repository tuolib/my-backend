/**
 * 订单用户端路由 — /api/v1/order/*
 * 需要 JWT 认证
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated, BadRequestError } from '@repo/shared';
import { authMiddleware, idempotentMiddleware } from '../middleware';
import * as orderService from '../services/order.service';
import {
  createOrderSchema,
  orderListSchema,
  orderDetailSchema,
  cancelOrderSchema,
} from '../schemas/order.schema';
import type { CreateOrderInput, OrderListInput, OrderDetailInput, CancelOrderInput } from '../types';

const order = new Hono<AppEnv>();

// 全局认证
order.use('/*', authMiddleware);

// POST /api/v1/order/create — 创建订单
// Header 必须携带 X-Idempotency-Key
order.post('/create', idempotentMiddleware, validate(createOrderSchema), async (c) => {
  const userId = c.get('userId');
  const idempotencyKey = c.req.header('X-Idempotency-Key');

  if (!idempotencyKey) {
    throw new BadRequestError('缺少 X-Idempotency-Key 头');
  }

  const input = c.get('validated') as CreateOrderInput;
  const result = await orderService.create(userId, input, idempotencyKey);
  return c.json(success(result, '订单创建成功'));
});

// POST /api/v1/order/list — 订单列表
order.post('/list', validate(orderListSchema), async (c) => {
  const userId = c.get('userId');
  const params = c.get('validated') as OrderListInput;
  const result = await orderService.list(userId, params);
  return c.json(paginated(result.items, result.pagination));
});

// POST /api/v1/order/detail — 订单详情
order.post('/detail', validate(orderDetailSchema), async (c) => {
  const userId = c.get('userId');
  const { orderId } = c.get('validated') as OrderDetailInput;
  const result = await orderService.detail(userId, orderId);
  return c.json(success(result));
});

// POST /api/v1/order/cancel — 取消订单
order.post('/cancel', validate(cancelOrderSchema), async (c) => {
  const userId = c.get('userId');
  const { orderId, reason } = c.get('validated') as CancelOrderInput;
  await orderService.cancel(userId, orderId, reason);
  return c.json(success(null, '订单已取消'));
});

export default order;
