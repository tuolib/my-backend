import { describe, test, expect } from 'bun:test';
import { getOrderShardTableName, formatShardNo } from './order-shard';

describe('formatShardNo', () => {
  test('pads single digit', () => {
    expect(formatShardNo(0)).toBe('00');
    expect(formatShardNo(1)).toBe('01');
    expect(formatShardNo(9)).toBe('09');
  });
  test('keeps double digit', () => {
    expect(formatShardNo(10)).toBe('10');
    expect(formatShardNo(63)).toBe('63');
  });
});

describe('getOrderShardTableName', () => {
  test('userId 0 → orders_00', () => {
    expect(getOrderShardTableName(0)).toBe('orders_00');
  });

  test('userId 1 → orders_01', () => {
    expect(getOrderShardTableName(1)).toBe('orders_01');
  });

  test('userId 63 → orders_63', () => {
    expect(getOrderShardTableName(63)).toBe('orders_63');
  });

  test('userId 64 → orders_00 (wraps)', () => {
    expect(getOrderShardTableName(64)).toBe('orders_00');
  });

  test('userId 65 → orders_01', () => {
    expect(getOrderShardTableName(65)).toBe('orders_01');
  });

  test('large userId (bigint)', () => {
    // 9999999999 % 64 = 9999999999 mod 64
    const shard = Number(9999999999n % 64n);
    expect(getOrderShardTableName(9999999999n)).toBe(`orders_${String(shard).padStart(2, '0')}`);
  });

  test('very large bigint', () => {
    const big = 123456789012345678n;
    const shard = Number(big % 64n);
    expect(getOrderShardTableName(big)).toBe(`orders_${String(shard).padStart(2, '0')}`);
  });

  test('negative-safe (bigint handles mod correctly)', () => {
    // Our implementation handles negative by adding SHARD_COUNT
    expect(getOrderShardTableName(-1)).toBe('orders_63');
    expect(getOrderShardTableName(-64)).toBe('orders_00');
  });
});
