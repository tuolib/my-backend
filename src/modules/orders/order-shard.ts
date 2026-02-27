/**
 * 订单分表路由工具
 * 规则：user_id % 64 → orders_00 ~ orders_63
 */

const SHARD_COUNT = 64;

/** 两位补零格式化 */
export function formatShardNo(n: number): string {
  return String(n).padStart(2, '0');
}

/** 根据 userId 计算落表名称 */
export function getOrderShardTableName(userId: number | bigint): string {
  const id = typeof userId === 'bigint' ? userId : BigInt(userId);
  const shard = Number(((id % BigInt(SHARD_COUNT)) + BigInt(SHARD_COUNT)) % BigInt(SHARD_COUNT));
  return `orders_${formatShardNo(shard)}`;
}
