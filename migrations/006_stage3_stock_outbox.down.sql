-- 回滚阶段三·第三步

DROP TABLE IF EXISTS archive_jobs;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS stock_ledger;

-- 回滚 skus.stock 列
ALTER TABLE skus DROP COLUMN IF EXISTS stock;
