/**
 * 管理端数据概览路由 — /api/v1/admin/dashboard/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { adminAuthMiddleware } from '../middleware';
import * as dashboardService from '../services/dashboard.service';
import { orderStatsSchema, salesStatsSchema } from '../schemas/dashboard.schema';
import type { OrderStatsInput, SalesStatsInput } from '../types';

const dashboard = new Hono<AppEnv>();

// 全局认证
dashboard.use('/*', adminAuthMiddleware);

// POST /api/v1/admin/dashboard/overview — 今日概览
dashboard.post('/overview', async (c) => {
  const result = await dashboardService.overview();
  return c.json(success(result));
});

// POST /api/v1/admin/dashboard/order-stats — 订单趋势
dashboard.post('/order-stats', validate(orderStatsSchema), async (c) => {
  const input = c.get('validated') as OrderStatsInput;
  const result = await dashboardService.orderStats(input);
  return c.json(success(result));
});

// POST /api/v1/admin/dashboard/sales-stats — 销售额趋势
dashboard.post('/sales-stats', validate(salesStatsSchema), async (c) => {
  const input = c.get('validated') as SalesStatsInput;
  const result = await dashboardService.salesStats(input);
  return c.json(success(result));
});

export default dashboard;
