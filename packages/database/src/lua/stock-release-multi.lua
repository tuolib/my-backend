-- stock-release-multi.lua — 多 SKU 批量释放
-- KEYS = [stock:sku1, stock:sku2, ...]
-- ARGV = [qty1, qty2, ...]
-- 返回: 0=成功

for i = 1, #KEYS do
  local stock = tonumber(redis.call('GET', KEYS[i]))
  if stock ~= nil then
    redis.call('INCRBY', KEYS[i], ARGV[i])
  end
end

return 0
