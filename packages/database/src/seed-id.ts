/**
 * seed-id.ts
 * 确定性 ID 生成器 — 基于 key 生成固定的 21 位 ID
 * 让 seed.ts 和 seed-prod.ts 在任何环境中对同一实体生成相同的 ID
 *
 * Key 约定:
 *   cat:{slug}          — 分类      e.g. seedId('cat:digital')
 *   prod:{slug}         — 商品      e.g. seedId('prod:iphone-15-pro-max')
 *   img:{slug}:{index}  — 商品图片  e.g. seedId('img:iphone-15-pro-max:0')
 *   sku:{code}          — SKU       e.g. seedId('sku:IP15PM-256-NAT')
 *   banner:{sort}       — 轮播图    e.g. seedId('banner:1')
 *   user:{email}        — 用户      e.g. seedId('user:admin@test.com')
 *   admin:{username}    — 管理员    e.g. seedId('admin:admin')
 */
import { createHash } from 'crypto';

// nanoid 默认字母表
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * 基于 key 生成确定性 ID（21 位，与 nanoid 格式兼容）
 * 同一 key 在任何环境中总是生成相同的 ID
 */
export function seedId(key: string): string {
  const hash = createHash('sha256').update(key).digest();
  let result = '';
  for (let i = 0; i < 21; i++) {
    result += ALPHABET[hash[i] % ALPHABET.length];
  }
  return result;
}
