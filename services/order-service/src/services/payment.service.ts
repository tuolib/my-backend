/**
 * 支付服务
 * 负责支付发起、三方回调处理、支付查询
 * ⚠️ 关键设计：
 *   - 回调幂等：同一 transactionId 多次调用结果一致
 *   - 回调无论处理成功失败，都返回 success 给三方（避免无限重试）
 *   - 支付成功后调用 stock/confirm（PG 乐观锁），移除超时 ZSET
 *   - 签名验证当前阶段预留 TODO
 */
import {
  generateId,
  ValidationError,
  NotFoundError,
  ErrorCode,
  isExpired,
  createLogger,
} from '@repo/shared';
import { redis } from '@repo/database';

import * as orderRepo from '../repositories/order.repo';
import * as orderItemRepo from '../repositories/order-item.repo';
import * as paymentRepo from '../repositories/payment.repo';
import * as productClient from './product-client';
import { OrderStatus, assertTransition } from '../state-machine/order-status';

import type {
  CreatePaymentInput,
  PaymentNotifyInput,
  PaymentInfo,
  PaymentStatusResult,
} from '../types';

const log = createLogger('payment');
const TIMEOUT_ZSET_KEY = 'order:timeout';

// ═══════════════════════════════════════════════════
// createPayment — 发起支付（返回支付参数给前端）
// ═══════════════════════════════════════════════════

export async function createPayment(
  userId: string,
  orderId: string,
  method: string,
): Promise<PaymentInfo> {
  // 1. 查订单 + 校验归属
  const order = await orderRepo.findById(orderId);
  if (!order || order.userId !== userId) {
    throw new NotFoundError('订单不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  // 2. 状态必须是 pending
  if (order.status !== OrderStatus.PENDING) {
    if (order.status === OrderStatus.PAID) {
      throw new ValidationError('订单已支付', ErrorCode.ORDER_ALREADY_PAID);
    }
    throw new ValidationError(
      '订单状态不允许支付',
      ErrorCode.ORDER_STATUS_INVALID,
      { status: order.status },
    );
  }

  // 3. 检查订单是否超时
  if (isExpired(order.expiresAt)) {
    throw new ValidationError('订单已超时', ErrorCode.ORDER_EXPIRED);
  }

  // 4. 创建 payment_record (status=pending)
  const paymentId = generateId();
  await paymentRepo.create({
    id: paymentId,
    orderId,
    paymentMethod: method,
    amount: order.payAmount,
    status: 'pending',
    idempotencyKey: `pay_${orderId}_${Date.now()}`,
  });

  // 5. 生成支付参数（当前模拟返回）
  // TODO: 真实对接时替换为 Stripe/支付宝 SDK 调用
  return {
    paymentId,
    method,
    amount: order.payAmount,
    payUrl: `mock://pay/${paymentId}?amount=${order.payAmount}&method=${method}`,
  };
}

// ═══════════════════════════════════════════════════
// handleNotify — 支付回调（三方异步通知）
// ═══════════════════════════════════════════════════

export async function handleNotify(
  body: PaymentNotifyInput,
): Promise<{ success: boolean }> {
  // 第 1 步：签名验证（预留）
  // TODO: 真实对接时在此验证三方签名

  // 第 2 步：幂等检查
  const existing = await paymentRepo.findByTransactionId(body.transactionId);
  if (existing) {
    // 已处理过，直接返回 success（幂等）
    return { success: true };
  }

  // 第 3 步：查订单
  const order = await orderRepo.findById(body.orderId);
  if (!order) {
    log.warn('notify for non-existent order', { orderId: body.orderId });
    return { success: true }; // 不让三方重试
  }

  if (order.status !== OrderStatus.PENDING) {
    log.warn('notify for order in non-pending status', {
      orderId: body.orderId, status: order.status,
    });
    return { success: true }; // 不让三方重试
  }

  // 第 4 步：创建/更新 payment_record
  const paymentId = generateId();
  await paymentRepo.create({
    id: paymentId,
    orderId: body.orderId,
    paymentMethod: body.method,
    amount: String(body.amount),
    status: body.status,
    transactionId: body.transactionId,
    rawNotify: body.rawData ?? body,
  });

  // 第 5 步：支付成功 → 更新订单状态
  if (body.status === 'success') {
    assertTransition(order.status as OrderStatus, OrderStatus.PAID);

    const updated = await orderRepo.updateStatus(
      body.orderId,
      OrderStatus.PAID,
      order.version,
      {
        paidAt: new Date(),
        paymentMethod: body.method,
        paymentNo: body.transactionId,
      },
    );

    if (!updated) {
      // 乐观锁冲突 — 可能同时被取消或超时
      log.warn('optimistic lock conflict', { orderId: body.orderId });
      return { success: true };
    }

    // 第 6 步：库存确认（DB 乐观锁最终一致）
    const items = await orderItemRepo.findByOrderId(body.orderId);
    try {
      await productClient.confirmStock(
        items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
        body.orderId,
      );
    } catch (err) {
      log.error('stock confirm failed', {
        orderId: body.orderId, error: (err as Error).message,
      });
      // 不影响支付回调返回，库存确认可通过后续对账修复
    }

    // 第 7 步：移除超时 ZSET
    await redis.zrem(TIMEOUT_ZSET_KEY, body.orderId);

    // 第 8 步：更新商品销量（best effort）
    // TODO: 暂不实现，留给后续版本
  }

  return { success: true };
}

// ═══════════════════════════════════════════════════
// queryPayment — 查询支付状态
// ═══════════════════════════════════════════════════

export async function queryPayment(
  userId: string,
  orderId: string,
): Promise<PaymentStatusResult> {
  const order = await orderRepo.findById(orderId);
  if (!order || order.userId !== userId) {
    throw new NotFoundError('订单不存在', ErrorCode.ORDER_NOT_FOUND);
  }

  const records = await paymentRepo.findByOrderId(orderId);

  return {
    orderId: order.id,
    orderStatus: order.status,
    payments: records.map((r) => ({
      id: r.id,
      method: r.paymentMethod,
      amount: r.amount,
      status: r.status,
      transactionId: r.transactionId,
      createdAt: r.createdAt,
    })),
  };
}
