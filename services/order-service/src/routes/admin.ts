/**
 * 管理端订单路由 — /api/v1/admin/order/*
 * 需要认证（当前不检查 admin 角色，预留）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated } from '@repo/shared';
import { authMiddleware } from '../middleware';
import * as orderService from '../services/order.service';
import { orderListSchema, shipOrderSchema } from '../schemas/order.schema';
import type { OrderListInput, ShipOrderInput } from '../types';

const admin = new Hono<AppEnv>();

// 全局认证
admin.use('/*', authMiddleware);

// POST /api/v1/admin/order/list — 管理端订单列表
admin.post('/list', validate(orderListSchema), async (c) => {
  const params = c.get('validated') as OrderListInput;
  const result = await orderService.adminList(params);
  return c.json(paginated(result.items, result.pagination));
});

// POST /api/v1/admin/order/ship — 管理员发货
admin.post('/ship', validate(shipOrderSchema), async (c) => {
  const { orderId, trackingNo } = c.get('validated') as ShipOrderInput;
  await orderService.ship(orderId, trackingNo);
  return c.json(success(null, '已发货'));
});

export default admin;
