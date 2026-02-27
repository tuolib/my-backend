-- 阶段三·第三步：库存流水 + 出站事件 + 归档任务骨架

-- ========== 补充 skus.stock 列（设计文档要求，004 遗漏） ==========
ALTER TABLE skus ADD COLUMN IF NOT EXISTS stock INT NOT NULL DEFAULT 0;

-- ========== A) 库存流水表 stock_ledger ==========
CREATE TABLE IF NOT EXISTS stock_ledger (
  id              BIGSERIAL PRIMARY KEY,
  sku_id          BIGINT NOT NULL,
  order_id        BIGINT,
  delta           INT NOT NULL,
  reason          VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_stock_ledger_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_sku    ON stock_ledger (sku_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_order  ON stock_ledger (order_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_cat    ON stock_ledger (created_at);

-- ========== B) 出站事件表 outbox_events ==========
CREATE TABLE IF NOT EXISTS outbox_events (
  id             BIGSERIAL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  aggregate_type VARCHAR(32) NOT NULL,
  aggregate_id   VARCHAR(64) NOT NULL,
  payload        JSONB NOT NULL,
  status         SMALLINT NOT NULL DEFAULT 0,
  retry_count    INT NOT NULL DEFAULT 0,
  next_retry_at  TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_events (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate    ON outbox_events (aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_created      ON outbox_events (created_at);

-- ========== C) 归档任务记录表 archive_jobs ==========
CREATE TABLE IF NOT EXISTS archive_jobs (
  id             BIGSERIAL PRIMARY KEY,
  job_date       DATE NOT NULL,
  target_table   VARCHAR(64) NOT NULL,
  status         SMALLINT NOT NULL DEFAULT 0,
  processed_rows BIGINT NOT NULL DEFAULT 0,
  error_msg      TEXT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_archive_jobs_date_table UNIQUE (job_date, target_table)
);
