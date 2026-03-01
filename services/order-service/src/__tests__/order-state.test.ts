/**
 * 订单状态机单元测试
 * 测试所有合法/非法的状态流转
 */
import { describe, test, expect } from 'bun:test';
import { OrderStatus, canTransition, assertTransition } from '../state-machine/order-status';

describe('Order State Machine', () => {
  // ── 合法流转 ──

  test('pending → paid ✅', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.PAID)).toBe(true);
  });

  test('pending → cancelled ✅', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(true);
  });

  test('paid → shipped ✅', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.SHIPPED)).toBe(true);
  });

  test('paid → refunded ✅', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.REFUNDED)).toBe(true);
  });

  test('shipped → delivered ✅', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
  });

  test('delivered → completed ✅', () => {
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.COMPLETED)).toBe(true);
  });

  // ── 非法流转 ──

  test('pending → shipped ❌', () => {
    expect(canTransition(OrderStatus.PENDING, OrderStatus.SHIPPED)).toBe(false);
  });

  test('cancelled → paid ❌', () => {
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PAID)).toBe(false);
  });

  test('completed → cancelled ❌', () => {
    expect(canTransition(OrderStatus.COMPLETED, OrderStatus.CANCELLED)).toBe(false);
  });

  test('refunded → paid ❌', () => {
    expect(canTransition(OrderStatus.REFUNDED, OrderStatus.PAID)).toBe(false);
  });

  test('delivered → cancelled ❌', () => {
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);
  });

  test('shipped → paid ❌', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.PAID)).toBe(false);
  });

  // ── assertTransition 测试 ──

  test('assertTransition — 合法流转不抛异常', () => {
    expect(() => assertTransition(OrderStatus.PENDING, OrderStatus.PAID)).not.toThrow();
  });

  test('assertTransition — 非法流转抛 ValidationError', () => {
    expect(() => assertTransition(OrderStatus.PENDING, OrderStatus.SHIPPED)).toThrow();
  });

  test('assertTransition — 错误包含 details', () => {
    try {
      assertTransition(OrderStatus.COMPLETED, OrderStatus.CANCELLED);
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.statusCode).toBe(422);
      expect(err.errorCode).toBe('ORDER_4002');
      expect(err.details).toHaveProperty('from', 'completed');
      expect(err.details).toHaveProperty('to', 'cancelled');
      expect(err.details.allowed).toEqual([]);
    }
  });

  // ── 终态不能流转 ──

  test('completed 是终态', () => {
    const targets = Object.values(OrderStatus);
    for (const target of targets) {
      expect(canTransition(OrderStatus.COMPLETED, target)).toBe(false);
    }
  });

  test('cancelled 是终态', () => {
    const targets = Object.values(OrderStatus);
    for (const target of targets) {
      expect(canTransition(OrderStatus.CANCELLED, target)).toBe(false);
    }
  });

  test('refunded 是终态', () => {
    const targets = Object.values(OrderStatus);
    for (const target of targets) {
      expect(canTransition(OrderStatus.REFUNDED, target)).toBe(false);
    }
  });
});
