/**
 * 订单核心编排层
 * 负责订单创建全流程（跨服务编排）、查询、取消、管理端操作
 * ⚠️ 关键设计：
 *   - 金额由服务端计算，不信任前端传入的任何价格
 *   - order_items 中所有字段都是快照（不 FK 到商品表）
 *   - 幂等：相同 idempotencyKey 返回原订单，不重复扣库存
 *   - 乐观锁：订单状态更新使用 WHERE version = :v
 *   - 库存预扣失败 → 直接抛出；PG 事务失败 → 必须 releaseStock 回滚
 *   - 购物车清理失败 → 只记告警日志，不影响订单
 */
import {
  generateId,
  generateOrderNo,
  addMinutes,
  ValidationError,
  NotFoundError,
  ErrorCode,
  InternalError,
  createLogger,
} from '@repo/shared';
import { db, redis } from '@repo/database';
import { orders, orderItems, orderAddresses } from '@repo/database';

import * as orderRepo from '../repositories/order.repo';
import * as orderItemRepo from '../repositories/order-item.repo';
import * as orderAddressRepo from '../repositories/order-address.repo';
import * as productClient from './product-client';
import * as cartClient from './cart-client';
import * as userClient from './user-client';
import { OrderStatus, assertTransition } from '../state-machine/order-status';

import type {
  CreateOrderInput,
  CreateOrderResult,
  OrderListInput,
  OrderListItem,
  OrderDetailResult,
  OrderItemDetail,
  OrderAddressDetail,
} from '../types';
import type { PaginatedData, PaginationMeta } from '@repo/shared';

const log = createLogger('order');

// ── 常量 ──
const ORDER_TIMEOUT_MINUTES = 30;
const TIMEOUT_ZSET_KEY = 'order:timeout';

// ═══════════════════════════════════════════════════
// create — 订单创建（最核心的编排流程）
// ═══════════════════════════════════════════════════

export async function create(
  userId: string,
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<CreateOrderResult> {
  // 第 1 步：幂等检查 — 相同 key 返回原订单
  const existing = await orderRepo.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      orderId: existing.id,
      orderNo: existing.orderNo,
      payAmount: existing.payAmount,
      expiresAt: existing.expiresAt,
    };
  }

  // 第 2 步：获取 SKU 实时数据
  const skuIds = input.items.map((i) => i.skuId);
  const skuDetails = await productClient.fetchSkuBatch(skuIds);
  const skuMap = new Map(skuDetails.map((s) => [s.id, s]));

  // 检查所有 SKU 是否存在且可用
  for (const item of input.items) {
    const sku = skuMap.get(item.skuId);
    if (!sku || sku.status !== 'active') {
      throw new ValidationError(
        '商品已下架或不存在',
        ErrorCode.PRODUCT_UNAVAILABLE,
        { skuId: item.skuId },
      );
    }
  }

  // 第 3 步：服务端重新计算金额 ⚠️ 不信任前端传来的价格
  const itemSnapshots = input.items.map((item) => {
    const sku = skuMap.get(item.skuId)!;
    const unitPrice = sku.price; // 使用实时价格
    const subtotal = (parseFloat(unitPrice) * item.quantity).toFixed(2);
    return {
      skuId: item.skuId,
      productId: sku.productId,
      productTitle: sku.productTitle,
      skuAttrs: sku.attributes ?? {},
      imageUrl: sku.primaryImage,
      unitPrice,
      quantity: item.quantity,
      subtotal,
    };
  });

  const totalAmount = itemSnapshots
    .reduce((sum, i) => sum + parseFloat(i.subtotal), 0)
    .toFixed(2);
  const discountAmount = '0.00';
  const payAmount = (parseFloat(totalAmount) - parseFloat(discountAmount)).toFixed(2);

  // 第 4 步：获取收货地址快照
  const address = await userClient.fetchAddress(input.addressId, userId);
  if (!address) {
    throw new NotFoundError('收货地址不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  // 第 5 步：库存预扣（Redis Lua 原子操作）
  // 失败（STOCK_INSUFFICIENT）直接抛出，流程终止
  const stockItems = input.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity }));
  const orderId = generateId();

  await productClient.reserveStock(stockItems, orderId);

  // 第 6 步：PG 事务 — 创建订单全部数据
  // ⚠️ 如果事务失败，必须释放库存
  let order;
  const orderNo = generateOrderNo();
  const now = new Date();
  const expiresAt = addMinutes(now, ORDER_TIMEOUT_MINUTES);

  try {
    order = await db.transaction(async (tx) => {
      // 创建订单主表
      const [createdOrder] = await tx
        .insert(orders)
        .values({
          id: orderId,
          orderNo,
          userId,
          status: OrderStatus.PENDING,
          totalAmount,
          discountAmount,
          payAmount,
          remark: input.remark ?? null,
          idempotencyKey,
          expiresAt,
        })
        .returning();

      // 批量创建订单商品（快照数据）
      await tx.insert(orderItems).values(
        itemSnapshots.map((snap) => ({
          id: generateId(),
          orderId,
          productId: snap.productId,
          skuId: snap.skuId,
          productTitle: snap.productTitle,
          skuAttrs: snap.skuAttrs,
          imageUrl: snap.imageUrl,
          unitPrice: snap.unitPrice,
          quantity: snap.quantity,
          subtotal: snap.subtotal,
        })),
      );

      // 创建地址快照
      await tx.insert(orderAddresses).values({
        id: generateId(),
        orderId,
        recipient: address.recipient,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        address: address.address,
        postalCode: address.postalCode,
      });

      return createdOrder;
    });
  } catch (err: any) {
    // PG unique constraint on idempotency_key (code 23505) → 并发幂等竞争
    // 释放本次库存预扣，返回先成功插入的那条订单
    if (err?.code === '23505' && String(err?.constraint_name ?? err?.message ?? '').includes('idempotency')) {
      log.warn('idempotency race detected, releasing stock', { orderId });
      await productClient.releaseStock(stockItems, orderId);
      const winner = await orderRepo.findByIdempotencyKey(idempotencyKey);
      if (winner) {
        return {
          orderId: winner.id,
          orderNo: winner.orderNo,
          payAmount: winner.payAmount,
          expiresAt: winner.expiresAt,
        };
      }
    }
    // 其他 PG 事务失败 → 回滚库存预扣并抛出
    log.error('PG transaction failed, releasing stock', { error: (err as Error).message });
    await productClient.releaseStock(stockItems, orderId);
    throw err;
  }

  // 第 7 步：设置超时 ZSET — score = expiresAt 的 Unix timestamp
  await redis.zadd(TIMEOUT_ZSET_KEY, expiresAt.getTime(), orderId);

  // 第 8 步：清理购物车（best effort，失败不影响订单）
  cartClient.clearCartItems(userId, skuIds).catch((err) => {
    log.warn('cart cleanup failed', { error: (err as Error).message });
  });

  // 第 9 步：返回
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    payAmount: order.payAmount,
    expiresAt: order.expiresAt,
  };
}

// ═══════════════════════════════════════════════════
// list — 用户订单列表
// ═══════════════════════════════════════════════════

export async function list(
  userId: string,
  params: OrderListInput,
): Promise<PaginatedData<OrderListItem>> {
  const { items: orderList, total } = await orderRepo.findByUserId({
    userId,
    page: params.page,
    pageSize: params.pageSize,
    status: params.status,
  });

  // 查每个订单的 items（首条 + 数量）
  const result: OrderListItem[] = await Promise.all(
    orderList.map(async (order) => {
      const items = await orderItemRepo.findByOrderId(order.id);
      const firstItem = items[0]
        ? {
            productTitle: items[0].productTitle,
            imageUrl: items[0].imageUrl,
            skuAttrs: items[0].skuAttrs,
          }
        : null;

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        payAmount: order.payAmount,
        itemCount: items.length,
        firstItem,
        createdAt: order.createdAt,
      };
    }),
  );

  const pagination: PaginationMeta = {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize),
  };

  return { items: result, pagination };
}

// ═══════════════════════════════════════════════════
// detail — 订单详情
// ═══════════════════════════════════════════════════

export async function detail(
  userId: string,
  orderId: string,
): Promise<OrderDetailResult> {
  const order = await orderRepo.findById(orderId);

  // 校验归属：不存在或不属于该用户 → 404（不暴露是否存在）
  if (!order || order.userId !== userId) {
    throw new NotFoundError('订单不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  const [items, address] = await Promise.all([
    orderItemRepo.findByOrderId(orderId),
    orderAddressRepo.findByOrderId(orderId),
  ]);

  const itemDetails: OrderItemDetail[] = items.map((i) => ({
    id: i.id,
    productId: i.productId,
    skuId: i.skuId,
    productTitle: i.productTitle,
    skuAttrs: i.skuAttrs,
    imageUrl: i.imageUrl,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    subtotal: i.subtotal,
  }));

  const addressDetail: OrderAddressDetail | null = address
    ? {
        recipient: address.recipient,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        address: address.address,
        postalCode: address.postalCode,
      }
    : null;

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    status: order.status,
    totalAmount: order.totalAmount,
    discountAmount: order.discountAmount,
    payAmount: order.payAmount,
    remark: order.remark,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt,
    items: itemDetails,
    address: addressDetail,
  };
}

// ═══════════════════════════════════════════════════
// cancel — 用户取消订单
// ═══════════════════════════════════════════════════

export async function cancel(
  userId: string,
  orderId: string,
  reason?: string,
): Promise<void> {
  // 1. 查订单 + 校验归属
  const order = await orderRepo.findById(orderId);
  if (!order || order.userId !== userId) {
    throw new NotFoundError('订单不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  // 2. 状态检查
  assertTransition(order.status as OrderStatus, OrderStatus.CANCELLED);

  // 3. 乐观锁更新状态
  const updated = await orderRepo.updateStatus(
    orderId,
    OrderStatus.CANCELLED,
    order.version,
    {
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    },
  );

  if (!updated) {
    throw new ValidationError(
      '订单状态已变更，请刷新后重试',
      ErrorCode.ORDER_STATUS_INVALID,
    );
  }

  // 4. 释放库存
  const items = await orderItemRepo.findByOrderId(orderId);
  const stockItems = items.map((i) => ({ skuId: i.skuId, quantity: i.quantity }));
  await productClient.releaseStock(stockItems, orderId);

  // 5. 移除超时 ZSET
  await redis.zrem(TIMEOUT_ZSET_KEY, orderId);
}

// ═══════════════════════════════════════════════════
// adminList — 管理端订单列表（无 userId 过滤）
// ═══════════════════════════════════════════════════

export async function adminList(
  params: OrderListInput,
): Promise<PaginatedData<OrderListItem>> {
  const { items: orderList, total } = await orderRepo.findAll({
    page: params.page,
    pageSize: params.pageSize,
    status: params.status,
  });

  const result: OrderListItem[] = await Promise.all(
    orderList.map(async (order) => {
      const items = await orderItemRepo.findByOrderId(order.id);
      const firstItem = items[0]
        ? {
            productTitle: items[0].productTitle,
            imageUrl: items[0].imageUrl,
            skuAttrs: items[0].skuAttrs,
          }
        : null;

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        payAmount: order.payAmount,
        itemCount: items.length,
        firstItem,
        createdAt: order.createdAt,
      };
    }),
  );

  const pagination: PaginationMeta = {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize),
  };

  return { items: result, pagination };
}

// ═══════════════════════════════════════════════════
// ship — 管理员发货
// ═══════════════════════════════════════════════════

export async function ship(
  orderId: string,
  trackingNo?: string,
): Promise<void> {
  const order = await orderRepo.findById(orderId);
  if (!order) {
    throw new NotFoundError('订单不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  // 状态检查：只有 paid 可以发货
  assertTransition(order.status as OrderStatus, OrderStatus.SHIPPED);

  const updated = await orderRepo.updateStatus(
    orderId,
    OrderStatus.SHIPPED,
    order.version,
    { shippedAt: new Date() },
  );

  if (!updated) {
    throw new ValidationError(
      '订单状态已变更，请刷新后重试',
      ErrorCode.ORDER_STATUS_INVALID,
    );
  }
}
