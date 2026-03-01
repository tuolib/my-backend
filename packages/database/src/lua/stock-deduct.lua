-- stock-deduct.lua — 单 SKU 库存扣减（原子操作）
-- KEYS[1] = stock:{skuId}
-- ARGV[1] = quantity (要扣减的数量)
-- 返回: 1=成功, 0=库存不足, -1=key不存在

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end
if stock < tonumber(ARGV[1]) then return 0 end
redis.call('DECRBY', KEYS[1], ARGV[1])
return 1
