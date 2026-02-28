import { describe, expect, test } from 'bun:test';
import { now, addMinutes, addDays, isExpired, formatISO } from './time';

describe('now()', () => {
  test('should return a Date instance', () => {
    const result = now();
    expect(result).toBeInstanceOf(Date);
  });

  test('should return current time (within 100ms)', () => {
    const result = now();
    expect(Math.abs(result.getTime() - Date.now())).toBeLessThan(100);
  });
});

describe('addMinutes()', () => {
  test('should add minutes correctly', () => {
    const base = new Date('2025-01-01T00:00:00Z');
    const result = addMinutes(base, 30);
    expect(result.toISOString()).toBe('2025-01-01T00:30:00.000Z');
  });

  test('should handle negative minutes', () => {
    const base = new Date('2025-01-01T01:00:00Z');
    const result = addMinutes(base, -30);
    expect(result.toISOString()).toBe('2025-01-01T00:30:00.000Z');
  });
});

describe('addDays()', () => {
  test('should add days correctly', () => {
    const base = new Date('2025-01-01T00:00:00Z');
    const result = addDays(base, 7);
    expect(result.toISOString()).toBe('2025-01-08T00:00:00.000Z');
  });
});

describe('isExpired()', () => {
  test('should return true for past dates', () => {
    const past = new Date('2020-01-01T00:00:00Z');
    expect(isExpired(past)).toBe(true);
  });

  test('should return false for future dates', () => {
    const future = addDays(now(), 1);
    expect(isExpired(future)).toBe(false);
  });
});

describe('formatISO()', () => {
  test('should return ISO 8601 string', () => {
    const date = new Date('2025-06-15T12:30:00.000Z');
    expect(formatISO(date)).toBe('2025-06-15T12:30:00.000Z');
  });
});
