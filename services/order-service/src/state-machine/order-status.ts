/**
 * 订单状态机
 * 定义合法的状态流转，非法流转一律 422 ORDER_STATUS_INVALID
 */
import { ValidationError, ErrorCode } from '@repo/shared';

export enum OrderStatus {
  PENDING   = 'pending',
  PAID      = 'paid',
  SHIPPED   = 'shipped',
  DELIVERED = 'delivered',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED  = 'refunded',
}

/** 合法状态流转表 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]:   [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]:      [OrderStatus.SHIPPED, OrderStatus.REFUNDED],
  [OrderStatus.SHIPPED]:   [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]:  [],
};

/** 检查状态是否可以流转 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** 断言状态流转合法，否则抛 422 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ValidationError(
      `订单状态不允许从 ${from} 变为 ${to}`,
      ErrorCode.ORDER_STATUS_INVALID,
      { from, to, allowed: TRANSITIONS[from] ?? [] },
    );
  }
}
