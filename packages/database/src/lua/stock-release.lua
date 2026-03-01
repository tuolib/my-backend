-- stock-release.lua — 库存释放（订单取消/超时）
-- KEYS[1] = stock:{skuId}
-- ARGV[1] = quantity (要释放的数量)
-- 返回: 释放后的库存值, -1=key不存在

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end
return redis.call('INCRBY', KEYS[1], ARGV[1])
