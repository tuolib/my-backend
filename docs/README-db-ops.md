# 数据库运维手册

## 一、日常维护命令

```bash
# 执行全量维护（建分区 + 归档 + outbox 清理）
bun run ops:maintenance

# 在 sim 环境执行
bun sim:ops:maintenance
```

---

## 二、监控查询 SQL

### 1. 分区是否齐全

```sql
-- 查看 payments 所有子分区
SELECT inhrelid::regclass AS partition_name
FROM pg_inherits
WHERE inhparent = 'payments'::regclass
ORDER BY 1;

-- 查看 orders_archive 所有子分区
SELECT inhrelid::regclass AS partition_name
FROM pg_inherits
WHERE inhparent = 'orders_archive'::regclass
ORDER BY 1;

-- 检查下月分区是否已创建（结合当前日期）
SELECT ensure_payments_month_partition((date_trunc('month', now()) + interval '1 month')::date);
SELECT ensure_orders_archive_month_partition((date_trunc('month', now()) + interval '1 month')::date);
```

### 2. Outbox 积压监控

```sql
-- 各状态统计（0=pending, 1=sent, 2=failed）
SELECT status,
       count(*)              AS cnt,
       min(created_at)       AS oldest,
       max(retry_count)      AS max_retries
FROM outbox_events
GROUP BY status
ORDER BY status;

-- 待重试事件（failed 且到期）
SELECT id, event_type, aggregate_id, retry_count, next_retry_at, last_error
FROM outbox_events
WHERE status = 2 AND next_retry_at <= now()
ORDER BY next_retry_at
LIMIT 20;

-- 长期 pending（超过 5 分钟未处理）
SELECT count(*) AS stale_pending
FROM outbox_events
WHERE status = 0 AND created_at < now() - interval '5 minutes';
```

### 3. 归档任务执行历史

```sql
SELECT id, job_date, target_table, status, processed_rows,
       error_msg, started_at, finished_at,
       finished_at - started_at AS duration
FROM archive_jobs
ORDER BY job_date DESC
LIMIT 20;
```

### 4. 订单分表行数与热度

```sql
-- 各分表行数概览
DO $$
DECLARE
  i INT; tbl TEXT; cnt BIGINT;
BEGIN
  FOR i IN 0..63 LOOP
    tbl := 'orders_' || LPAD(i::TEXT, 2, '0');
    EXECUTE format('SELECT count(*) FROM %I', tbl) INTO cnt;
    IF cnt > 0 THEN
      RAISE NOTICE '%: % rows', tbl, cnt;
    END IF;
  END LOOP;
END $$;

-- 或使用 pg_stat_user_tables 统计（近似值，无需全表扫描）
SELECT relname, n_live_tup AS approx_rows, last_autovacuum
FROM pg_stat_user_tables
WHERE relname ~ '^orders_\d{2}$'
ORDER BY n_live_tup DESC;
```

### 5. 库存流水审计

```sql
-- 某 SKU 最近流水
SELECT id, sku_id, order_id, delta, reason, idempotency_key, created_at
FROM stock_ledger
WHERE sku_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- 检查 reserve/commit 是否配对
SELECT sku_id,
       sum(CASE WHEN reason = 'reserve' THEN delta ELSE 0 END)  AS reserved,
       sum(CASE WHEN reason = 'commit'  THEN delta ELSE 0 END)  AS committed,
       sum(CASE WHEN reason = 'rollback' THEN delta ELSE 0 END) AS rolled_back
FROM stock_ledger
GROUP BY sku_id;
```

---

## 三、常见故障处理

### 故障1：分区缺失

**现象**: INSERT 报错 `no partition of relation "payments" found for row`

**处理**:
```sql
-- 手动创建缺失分区
SELECT ensure_payments_month_partition('2026-04-01'::DATE);
-- 或创建 orders_archive 分区
SELECT ensure_orders_archive_month_partition('2026-04-01'::DATE);
```

**预防**: 确保 `ops:maintenance` 每日执行（会提前建下月分区）。

### 故障2：Outbox 积压

**现象**: pending 数量持续增长，`/internal/outbox/process` 处理后 failed 增多

**排查**:
```sql
-- 查看失败原因
SELECT event_type, last_error, count(*), max(retry_count)
FROM outbox_events
WHERE status = 2
GROUP BY event_type, last_error;
```

**处理**:
1. 检查 PG 库存是否充足（`SELECT id, stock FROM skus WHERE id = ?`）
2. 手动重置失败事件为 pending：
   ```sql
   UPDATE outbox_events SET status = 0, next_retry_at = NULL WHERE status = 2 AND retry_count > 5;
   ```

### 故障3：归档失败

**排查**:
```sql
SELECT * FROM archive_jobs WHERE status = 3 ORDER BY job_date DESC LIMIT 5;
```

**常见原因**:
- 目标月分区不存在 → 先执行 `ensure_orders_archive_month_partition`
- 磁盘空间不足 → 清理或扩容

### 故障4：Redis 与 PG 库存不一致

**排查**:
```bash
# Redis 当前值
redis-cli GET stock:{skuId}
```
```sql
-- PG 当前值
SELECT id, stock FROM skus WHERE id = {skuId};
-- 流水汇总
SELECT sum(delta) AS net_delta FROM stock_ledger WHERE sku_id = {skuId};
```

**处理**: 以 PG 为准，重置 Redis：
```bash
redis-cli SET stock:{skuId} <pg_stock_value>
```

---

## 四、回滚说明

```bash
# 回滚 007（删除运维函数）
bun run migrate:down
# 或在 sim 环境
docker compose -f docker-compose.sim.yml run --rm api-1 bun run migrate:down
```

回滚后影响：
- `ensure_*_month_partition` / `run_orders_archive` / `cleanup_outbox_events` 函数被删除
- `ops:maintenance` 脚本将无法执行
- 不影响已有数据和已创建的分区
