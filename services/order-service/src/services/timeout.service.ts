/**
 * 订单超时自动取消服务
 * 每 10 秒轮询 Redis ZSET order:timeout，取出过期订单执行取消 + 释放库存
 * ⚠️ 关键设计：
 *   - 防重叠：running flag 保证上一轮未完成时不启动下一轮
 *   - 仅处理 pending 状态（已支付/已取消跳过）
 *   - 乐观锁冲突不从 ZSET 移除（下轮重试）
 *   - 取消失败不从 ZSET 移除（下轮重试），成功才移除
 */
import { redis } from '@repo/database';

import * as orderRepo from '../repositories/order.repo';
import * as orderItemRepo from '../repositories/order-item.repo';
import * as productClient from './product-client';
import { OrderStatus } from '../state-machine/order-status';

const TIMEOUT_ZSET_KEY = 'order:timeout';

export class OrderTimeoutChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private intervalMs = 10_000; // 10 秒
  private batchSize = 50;

  start(): void {
    if (this.timer) return;
    console.log('[TIMEOUT] Checker started, interval=%dms', this.intervalMs);
    this.timer = setInterval(() => this.check(), this.intervalMs);
    // 启动时立即执行一次
    this.check();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[TIMEOUT] Checker stopped');
    }
  }

  /** 测试用：调整间隔 */
  setInterval(ms: number): void {
    this.intervalMs = ms;
  }

  /** 测试用：手动触发一轮检查 */
  async check(): Promise<void> {
    if (this.running) return; // 防止重叠执行
    this.running = true;

    try {
      const now = Date.now(); // ZADD 时用的是毫秒 timestamp

      // 从 ZSET 取出过期的 orderId
      const expiredOrderIds = await redis.zrangebyscore(
        TIMEOUT_ZSET_KEY,
        0,
        now,
        'LIMIT',
        0,
        this.batchSize,
      );

      if (expiredOrderIds.length === 0) return;

      console.log('[TIMEOUT] Found %d expired orders', expiredOrderIds.length);

      for (const orderId of expiredOrderIds) {
        await this.cancelExpiredOrder(orderId);
      }
    } catch (err) {
      console.error('[TIMEOUT] Check failed:', err);
    } finally {
      this.running = false;
    }
  }

  private async cancelExpiredOrder(orderId: string): Promise<void> {
    try {
      // 1. 查订单
      const order = await orderRepo.findById(orderId);
      if (!order) {
        await redis.zrem(TIMEOUT_ZSET_KEY, orderId);
        return;
      }

      // 2. 仅处理 pending 状态（可能已被用户取消或已支付）
      if (order.status !== OrderStatus.PENDING) {
        await redis.zrem(TIMEOUT_ZSET_KEY, orderId);
        return;
      }

      // 3. 乐观锁更新状态 → cancelled
      const updated = await orderRepo.updateStatus(
        orderId,
        OrderStatus.CANCELLED,
        order.version,
        { cancelledAt: new Date(), cancelReason: '支付超时自动取消' },
      );

      if (!updated) {
        // 乐观锁冲突（可能同时被用户取消/支付），下次循环再检查
        console.warn('[TIMEOUT] Optimistic lock conflict for order %s', orderId);
        return;
      }

      // 4. 释放库存
      const items = await orderItemRepo.findByOrderId(orderId);
      await productClient.releaseStock(
        items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
        orderId,
      );

      // 5. 从 ZSET 移除
      await redis.zrem(TIMEOUT_ZSET_KEY, orderId);

      console.log('[TIMEOUT] Order %s auto-cancelled, stock released', orderId);
    } catch (err) {
      console.error('[TIMEOUT] Failed to cancel order %s:', orderId, err);
      // 不从 ZSET 移除，下次循环重试
    }
  }
}
