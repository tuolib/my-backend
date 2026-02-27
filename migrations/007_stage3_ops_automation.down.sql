-- 回滚阶段三·第五步：删除运维函数

DROP FUNCTION IF EXISTS cleanup_outbox_events(INT);
DROP FUNCTION IF EXISTS run_orders_archive(DATE);
DROP FUNCTION IF EXISTS ensure_orders_archive_month_partition(DATE);
DROP FUNCTION IF EXISTS ensure_payments_month_partition(DATE);
