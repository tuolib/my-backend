import { nanoid } from 'nanoid';

/** 生成分布式唯一 ID（nanoid，默认 21 位） */
export function generateId(size?: number): string {
  return nanoid(size);
}

/** 生成短 ID（12 位，适用于非安全场景） */
export function generateShortId(): string {
  return nanoid(12);
}
