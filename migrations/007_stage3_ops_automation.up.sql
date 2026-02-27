-- 阶段三·第五步：生产化运维 — 自动分区、归档执行器、Outbox 清理

-- ========================================================================
-- A) 分区自动化函数
-- ========================================================================

-- 自动创建 payments 月分区
CREATE OR REPLACE FUNCTION ensure_payments_month_partition(target_month DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  part_name TEXT;
  start_d   DATE;
  end_d     DATE;
BEGIN
  start_d   := date_trunc('month', target_month)::DATE;
  end_d     := (start_d + INTERVAL '1 month')::DATE;
  part_name := 'payments_' || to_char(start_d, 'YYYY_MM');

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = part_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF payments FOR VALUES FROM (%L) TO (%L)',
      part_name, start_d, end_d
    );
    RETURN 'created: ' || part_name;
  ELSE
    RETURN 'exists: ' || part_name;
  END IF;
END;
$$;

-- 自动创建 orders_archive 月分区
CREATE OR REPLACE FUNCTION ensure_orders_archive_month_partition(target_month DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  part_name TEXT;
  start_d   DATE;
  end_d     DATE;
BEGIN
  start_d   := date_trunc('month', target_month)::DATE;
  end_d     := (start_d + INTERVAL '1 month')::DATE;
  part_name := 'orders_archive_' || to_char(start_d, 'YYYY_MM');

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = part_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF orders_archive FOR VALUES FROM (%L) TO (%L)',
      part_name, start_d, end_d
    );
    RETURN 'created: ' || part_name;
  ELSE
    RETURN 'exists: ' || part_name;
  END IF;
END;
$$;

-- ========================================================================
-- B) 归档执行函数
-- ========================================================================

CREATE OR REPLACE FUNCTION run_orders_archive(job_day DATE)
RETURNS TABLE(shard TEXT, moved_rows BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  i           INT;
  tbl         TEXT;
  cutoff      TIMESTAMPTZ;
  cnt         BIGINT;
  total_moved BIGINT := 0;
  job_id      BIGINT;
  err_text    TEXT;
BEGIN
  cutoff := job_day - INTERVAL '90 days';

  -- 创建或获取 archive_jobs 记录
  INSERT INTO archive_jobs (job_date, target_table, status, started_at)
  VALUES (job_day, 'orders_*', 1, now())
  ON CONFLICT (job_date, target_table) DO UPDATE
    SET status = 1, started_at = now(), error_msg = NULL
  RETURNING id INTO job_id;

  BEGIN
    FOR i IN 0..63 LOOP
      tbl := 'orders_' || LPAD(i::TEXT, 2, '0');

      EXECUTE format(
        'WITH moved AS (
           DELETE FROM %I WHERE created_at < $1
           RETURNING *
         )
         INSERT INTO orders_archive (id, user_id, total, status, created_at)
         SELECT id, user_id, total, status, created_at FROM moved',
        tbl
      ) USING cutoff;

      GET DIAGNOSTICS cnt = ROW_COUNT;
      total_moved := total_moved + cnt;

      IF cnt > 0 THEN
        shard := tbl;
        moved_rows := cnt;
        RETURN NEXT;
      END IF;
    END LOOP;

    -- 标记完成
    UPDATE archive_jobs
    SET status = 2, processed_rows = total_moved, finished_at = now()
    WHERE id = job_id;

  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_text = MESSAGE_TEXT;
    UPDATE archive_jobs
    SET status = 3, error_msg = err_text, finished_at = now(), processed_rows = total_moved
    WHERE id = job_id;
    RAISE;
  END;
END;
$$;

-- ========================================================================
-- C) Outbox 清理函数
-- ========================================================================

CREATE OR REPLACE FUNCTION cleanup_outbox_events(retain_days INT DEFAULT 30)
RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE
  deleted_count BIGINT;
BEGIN
  DELETE FROM outbox_events
  WHERE status = 1
    AND updated_at < now() - (retain_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
