-- stock-deduct-multi.lua — 多 SKU 原子扣减（一个订单多个商品）
-- KEYS = [stock:sku1, stock:sku2, ...]
-- ARGV = [qty1, qty2, ...]
-- 返回: 0=全部成功, >0=第 N 个 SKU 库存不足（从1开始）

-- 第一阶段：检查所有库存是否充足
for i = 1, #KEYS do
  local stock = tonumber(redis.call('GET', KEYS[i]))
  if stock == nil then return i end
  if stock < tonumber(ARGV[i]) then return i end
end

-- 第二阶段：全部充足，执行扣减
for i = 1, #KEYS do
  redis.call('DECRBY', KEYS[i], ARGV[i])
end

return 0
