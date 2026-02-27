-- 回滚阶段三·第二步
-- 恢复到"仅第一步完成"的状态

-- ========================================================================
-- C) 支付表：从分区表恢复为普通表（与 004 创建的一致）
-- ========================================================================

-- 1. 备份分区表数据到临时表
CREATE TABLE payments_backup AS SELECT * FROM payments;

-- 2. 删除分区表及其所有分区
DROP TABLE IF EXISTS payments CASCADE;

-- 3. 重建 004 原始普通表
CREATE TABLE payments (
  id       BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  channel  VARCHAR(20),
  amount   NUMERIC(12,2),
  status   SMALLINT DEFAULT 0,
  paid_at  TIMESTAMPTZ
);

-- 4. 恢复数据
INSERT INTO payments (id, order_id, channel, amount, status, paid_at)
SELECT id, order_id, channel, amount, status, paid_at FROM payments_backup;

SELECT setval(pg_get_serial_sequence('payments', 'id'),
              COALESCE((SELECT MAX(id) FROM payments), 1));

DROP TABLE payments_backup;

CREATE INDEX idx_payments_order ON payments(order_id);

-- ========================================================================
-- B) 删除归档分区表（CASCADE 会带走所有子分区）
-- ========================================================================
DROP TABLE IF EXISTS orders_archive CASCADE;

-- ========================================================================
-- A) 删除 64 张订单分表
-- ========================================================================
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I CASCADE',
                   'orders_' || LPAD(i::TEXT, 2, '0'));
  END LOOP;
END
$$;
