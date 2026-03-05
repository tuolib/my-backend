/**
 * Dashboard 数据概览服务
 * 聚合订单数据 + 跨服务获取用户统计
 */
import { db, orders, orderItems } from '@repo/database';
import { sql, eq, gte, and } from 'drizzle-orm';
import * as userClient from './user-client';

import type {
  DashboardOverview,
  OrderStatsInput,
  OrderStatsResult,
  SalesStatsInput,
  SalesStatsResult,
} from '../types';

const PAID_STATUSES = ['paid', 'shipped', 'delivered', 'completed'];

// ═══════════════════════════════════════════════════
// overview — 今日概览
// ═══════════════════════════════════════════════════

export async function overview(): Promise<DashboardOverview> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [orderRow, userStats] = await Promise.all([
    db
      .select({
        todayOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= ${todayStart})::int`,
        todaySales: sql<string>`coalesce(sum(${orders.payAmount}) filter (where ${orders.createdAt} >= ${todayStart} and ${orders.status} in ('paid','shipped','delivered','completed')), 0)`,
      })
      .from(orders)
      .then((rows) => rows[0]),
    userClient.fetchUserStats(),
  ]);

  return {
    todayOrders: orderRow?.todayOrders ?? 0,
    todaySales: orderRow?.todaySales ?? '0',
    newUsers: userStats.newToday,
    activeUsers: userStats.activeToday,
  };
}

// ═══════════════════════════════════════════════════
// orderStats — 订单趋势 + 状态分布
// ═══════════════════════════════════════════════════

export async function orderStats(input: OrderStatsInput): Promise<OrderStatsResult> {
  const { range, days = 7 } = input;
  const truncUnit = range === 'month' ? 'month' : range === 'week' ? 'week' : 'day';
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [trend, statusDist] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(date_trunc(${truncUnit}, ${orders.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orders.payAmount}) filter (where ${orders.status} in ('paid','shipped','delivered','completed')), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate))
      .groupBy(sql`date_trunc(${truncUnit}, ${orders.createdAt})`)
      .orderBy(sql`date_trunc(${truncUnit}, ${orders.createdAt})`),
    db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .groupBy(orders.status),
  ]);

  return {
    trend: trend.map((r) => ({
      date: r.date,
      count: r.count,
      amount: r.amount,
    })),
    statusDistribution: statusDist.map((r) => ({
      status: r.status,
      count: r.count,
    })),
  };
}

// ═══════════════════════════════════════════════════
// salesStats — 销售额趋势 + TOP 商品
// ═══════════════════════════════════════════════════

export async function salesStats(input: SalesStatsInput): Promise<SalesStatsResult> {
  const { range, days = 7 } = input;
  const truncUnit = range === 'month' ? 'month' : range === 'week' ? 'week' : 'day';
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const paidFilter = and(
    gte(orders.createdAt, startDate),
    sql`${orders.status} in ('paid','shipped','delivered','completed')`,
  );

  const [trend, topProducts] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(date_trunc(${truncUnit}, ${orders.createdAt}), 'YYYY-MM-DD')`,
        amount: sql<string>`coalesce(sum(${orders.payAmount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(paidFilter)
      .groupBy(sql`date_trunc(${truncUnit}, ${orders.createdAt})`)
      .orderBy(sql`date_trunc(${truncUnit}, ${orders.createdAt})`),
    db
      .select({
        productTitle: orderItems.productTitle,
        skuId: orderItems.skuId,
        quantity: sql<number>`sum(${orderItems.quantity})::int`,
        amount: sql<string>`sum(${orderItems.subtotal})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(paidFilter)
      .groupBy(orderItems.productTitle, orderItems.skuId)
      .orderBy(sql`sum(${orderItems.subtotal}) desc`)
      .limit(10),
  ]);

  return {
    trend: trend.map((r) => ({
      date: r.date,
      amount: r.amount,
      count: r.count,
    })),
    topProducts: topProducts.map((r) => ({
      productTitle: r.productTitle,
      skuId: r.skuId,
      quantity: r.quantity,
      amount: r.amount,
    })),
  };
}
