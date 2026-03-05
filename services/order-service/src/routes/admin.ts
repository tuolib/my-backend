/**
 * 管理端订单路由 — /api/v1/admin/order/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated } from '@repo/shared';
import { adminAuthMiddleware } from '../middleware';
import * as orderService from '../services/order.service';
import {
  orderListSchema,
  orderDetailSchema,
  cancelOrderSchema,
  shipOrderSchema,
  adminRefundSchema,
} from '../schemas/order.schema';
import type {
  OrderListInput,
  OrderDetailInput,
  CancelOrderInput,
  ShipOrderInput,
  AdminRefundInput,
} from '../types';

const admin = new Hono<AppEnv>();

// 全局认证
admin.use('/*', adminAuthMiddleware);

// POST /api/v1/admin/order/list — 管理端订单列表
admin.post('/list', validate(orderListSchema), async (c) => {
  const params = c.get('validated') as OrderListInput;
  const result = await orderService.adminList(params);
  return c.json(paginated(result.items, result.pagination));
});

// POST /api/v1/admin/order/detail — 管理端订单详情
admin.post('/detail', validate(orderDetailSchema), async (c) => {
  const { orderId } = c.get('validated') as OrderDetailInput;
  const result = await orderService.adminDetail(orderId);
  return c.json(success(result));
});

// POST /api/v1/admin/order/ship — 管理员发货
admin.post('/ship', validate(shipOrderSchema), async (c) => {
  const { orderId, trackingNo } = c.get('validated') as ShipOrderInput;
  await orderService.ship(orderId, trackingNo);
  return c.json(success(null, '已发货'));
});

// POST /api/v1/admin/order/cancel — 管理员取消订单
admin.post('/cancel', validate(cancelOrderSchema), async (c) => {
  const { orderId, reason } = c.get('validated') as CancelOrderInput;
  await orderService.adminCancel(orderId, reason);
  return c.json(success(null, '订单已取消'));
});

// POST /api/v1/admin/order/refund — 管理员退款
admin.post('/refund', validate(adminRefundSchema), async (c) => {
  const { orderId, reason } = c.get('validated') as AdminRefundInput;
  await orderService.adminRefund(orderId, reason);
  return c.json(success(null, '退款成功'));
});

export default admin;
