import { describe, expect, test } from 'bun:test';
import { generateId, generateOrderNo } from './id';

describe('generateId()', () => {
  test('should return a 21-character string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBe(21);
  });

  test('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateOrderNo()', () => {
  test('should start with YYYYMMDD date prefix', () => {
    const orderNo = generateOrderNo();
    const datePrefix = orderNo.slice(0, 8);
    const today = new Date();
    const expected = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');
    expect(datePrefix).toBe(expected);
  });

  test('should have total length of 16 (8 date + 8 random)', () => {
    const orderNo = generateOrderNo();
    expect(orderNo.length).toBe(16);
  });

  test('should generate unique order numbers', () => {
    const orders = new Set(Array.from({ length: 100 }, () => generateOrderNo()));
    expect(orders.size).toBe(100);
  });
});
