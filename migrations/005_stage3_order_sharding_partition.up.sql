-- 阶段三·第二步：订单 64 分表 + 归档分区 + 支付月分区
-- 注意：本迁移在单事务内执行（PG DDL 可事务化）

-- ========================================================================
-- A) 订单 64 张分表 orders_00 ~ orders_63
-- ========================================================================
DO $$
DECLARE
  i INT;
  tbl TEXT;
BEGIN
  FOR i IN 0..63 LOOP
    tbl := 'orders_' || LPAD(i::TEXT, 2, '0');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL,
        total      NUMERIC(12,2),
        status     SMALLINT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )', tbl);

    -- 索引：user_id
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_user_id ON %I (user_id)', tbl, tbl);

    -- 索引：created_at
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_created_at ON %I (created_at)', tbl, tbl);

    -- 复合索引：(user_id, created_at)
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_uid_cat ON %I (user_id, created_at)', tbl, tbl);

  END LOOP;
END
$$;

-- ========================================================================
-- B) 冷数据归档主表 orders_archive（按月 RANGE 分区）
-- ========================================================================
CREATE TABLE IF NOT EXISTS orders_archive (
  id         BIGINT NOT NULL,
  user_id    BIGINT NOT NULL,
  total      NUMERIC(12,2),
  status     SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

-- 示例月分区：2026-02、2026-03
CREATE TABLE IF NOT EXISTS orders_archive_2026_02
  PARTITION OF orders_archive
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS orders_archive_2026_03
  PARTITION OF orders_archive
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- 默认分区（兜底，防止数据落空报错）
CREATE TABLE IF NOT EXISTS orders_archive_default
  PARTITION OF orders_archive DEFAULT;

-- 归档表索引
CREATE INDEX IF NOT EXISTS idx_orders_archive_user_id ON orders_archive (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_archive_created_at ON orders_archive (created_at);

-- ========================================================================
-- C) 支付表改造为月分区结构
--    payments 已由 004 创建为普通表，需先迁移数据再重建为分区表
-- ========================================================================

-- 1. 备份旧表
ALTER TABLE payments RENAME TO payments_old;
DROP INDEX IF EXISTS idx_payments_order;

-- 2. 创建分区父表（字段与 004 一致）
CREATE TABLE payments (
  id       BIGSERIAL NOT NULL,
  order_id BIGINT NOT NULL,
  channel  VARCHAR(20),
  amount   NUMERIC(12,2),
  status   SMALLINT DEFAULT 0,
  paid_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (paid_at);

-- 3. 示例月分区：2026-02、2026-03
CREATE TABLE payments_2026_02
  PARTITION OF payments
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE payments_2026_03
  PARTITION OF payments
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- 默认分区
CREATE TABLE payments_default
  PARTITION OF payments DEFAULT;

-- 4. 迁移旧数据（paid_at 为 NULL 的行填充 now()）
INSERT INTO payments (id, order_id, channel, amount, status, paid_at)
SELECT id, order_id, channel, amount, status, COALESCE(paid_at, now())
FROM payments_old;

-- 5. 同步序列到最大 id
SELECT setval(pg_get_serial_sequence('payments', 'id'),
              COALESCE((SELECT MAX(id) FROM payments), 1));

-- 6. 删除旧表
DROP TABLE payments_old;

-- 7. 分区表索引
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_paid_at ON payments (paid_at);
