import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  createOrderSchema,
  payOrderSchema,
  cancelOrderSchema,
  listOrderSchema,
  detailOrderSchema,
} from './order.schema.ts';
import { OrderService, OrderError } from './order.service.ts';
import { ApiResult, onZodError } from '@/utils/response.ts';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const orderRoute = new Hono();

// 从 JWT payload 提取 userId 的辅助函数
const getUserId = (c: any): number => {
  const payload = c.get('jwtPayload') as { sub: string };
  return Number(payload.sub);
};

// POST /api/v1/orders/create — 下单
orderRoute.post(
  '/create',
  zValidator('json', createOrderSchema, onZodError),
  async (c) => {
    try {
      const order = await OrderService.create(getUserId(c), c.req.valid('json'));
      return ApiResult.success(c, order, '下单成功');
    } catch (e) {
      if (e instanceof OrderError) return ApiResult.error(c, e.message, e.statusCode as ContentfulStatusCode);
      throw e;
    }
  }
);

// POST /api/v1/orders/pay — 付款
orderRoute.post(
  '/pay',
  zValidator('json', payOrderSchema, onZodError),
  async (c) => {
    try {
      const order = await OrderService.pay(getUserId(c), c.req.valid('json').orderId);
      return ApiResult.success(c, order, '付款成功');
    } catch (e) {
      if (e instanceof OrderError) return ApiResult.error(c, e.message, e.statusCode as ContentfulStatusCode);
      throw e;
    }
  }
);

// POST /api/v1/orders/cancel — 取消订单
orderRoute.post(
  '/cancel',
  zValidator('json', cancelOrderSchema, onZodError),
  async (c) => {
    try {
      const order = await OrderService.cancel(getUserId(c), c.req.valid('json').orderId);
      return ApiResult.success(c, order, '订单已取消');
    } catch (e) {
      if (e instanceof OrderError) return ApiResult.error(c, e.message, e.statusCode as ContentfulStatusCode);
      throw e;
    }
  }
);

// POST /api/v1/orders/list — 我的订单历史
orderRoute.post(
  '/list',
  zValidator('json', listOrderSchema, onZodError),
  async (c) => {
    const { page, pageSize, status } = c.req.valid('json');
    const data = await OrderService.list(getUserId(c), page, pageSize, status);
    return ApiResult.success(c, data);
  }
);

// POST /api/v1/orders/detail — 订单详情
orderRoute.post(
  '/detail',
  zValidator('json', detailOrderSchema, onZodError),
  async (c) => {
    try {
      const data = await OrderService.detail(getUserId(c), c.req.valid('json').orderId);
      return ApiResult.success(c, data);
    } catch (e) {
      if (e instanceof OrderError) return ApiResult.error(c, e.message, e.statusCode as ContentfulStatusCode);
      throw e;
    }
  }
);

export { orderRoute };
