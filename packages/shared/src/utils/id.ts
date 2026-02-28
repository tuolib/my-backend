/**
 * ID 生成器
 * generateId: 通用主键（nanoid 21 位）
 * generateOrderNo: 订单号（日期前缀 + 随机串，如 "20250228A7xK9mP3"）
 */
import { nanoid } from 'nanoid';

/** 生成通用唯一 ID（nanoid 21 位） */
export function generateId(): string {
  return nanoid(21);
}

/** 生成订单号：YYYYMMDD + nanoid(8)，保证可读性 + 唯一性 */
export function generateOrderNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}${nanoid(8)}`;
}
