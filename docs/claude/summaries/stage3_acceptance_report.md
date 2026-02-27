# 阶段三验收报告 — 数据库设计

> 日期: 2026-02-27
> 版本: migrations 004~007

---

## 一、架构范围（本阶段完成内容）

| 步骤 | Migration | 内容 |
|------|-----------|------|
| 第一步 | 004 | 核心基础表：users 增量、products、skus、payments |
| 第二步 | 005 | 订单 64 分表 + orders_archive 月分区 + payments 月分区 |
| 第三步 | 006 | stock_ledger 库存流水 + outbox_events 出站表 + archive_jobs |
| 第四步 | — | 联调闭环：Redis 预扣 → PG 落盘 → Outbox 重试 |
| 第五步 | 007 | 生产化：自动分区函数、归档执行器、清理函数、运维脚本 |
| 第六步 | — | 验收：完整性校验、压测基线、故障演练 |

### 新增表

| 表 | 类型 | 说明 |
|----|------|------|
| products | 普通表 | 商品主表 |
| skus | 普通表 | SKU + stock 列 |
| payments | 分区表 (RANGE by paid_at) | 支付流水，月分区 |
| orders_00~63 | 64 张独立表 | 按 user_id % 64 分片路由 |
| orders_archive | 分区表 (RANGE by created_at) | 冷数据归档，月分区 |
| stock_ledger | 普通表 | 库存流水（幂等键去重） |
| outbox_events | 普通表 | 事件出站（pending→sent/failed 状态机） |
| archive_jobs | 普通表 | 归档任务记录 |

### SQL 函数

| 函数 | 用途 |
|------|------|
| ensure_payments_month_partition(DATE) | 自动建 payments 月分区 |
| ensure_orders_archive_month_partition(DATE) | 自动建 orders_archive 月分区 |
| run_orders_archive(DATE) | 归档 >90天订单冷数据 |
| cleanup_outbox_events(INT) | 清理已处理 outbox 事件 |

---

## 二、验收清单

### 功能验收

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 64 张订单分表创建 | ✅ | orders_00~63 全部存在 |
| 分片路由正确性 | ✅ | userId % 64 抽样 6 组全部正确 |
| 分区覆盖（当月+下月） | ✅ | payments/orders_archive 均有 |
| 关键索引齐全 | ✅ | 11 个索引/约束全部存在 |
| SQL 函数可用 | ✅ | 4 个函数全部注册 |
| 库存预扣→落盘闭环 | ✅ | Redis DECRBY + ledger + outbox → commitStockToDb |
| Outbox 批处理 | ✅ | processPendingOutboxBatch 可正常分派 |
| 维护脚本 | ✅ | ops:maintenance 可执行，幂等 |

### 一致性验收

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 幂等键去重 | ✅ | 重复 idempotency_key 返回 inserted=false，DB 仅 1 条 |
| outbox 失败→重试 | ✅ | 库存不足时 status=2，恢复后重试成功 |
| 分区创建幂等 | ✅ | 重复调用返回 exists，不报错 |
| 迁移幂等 | ✅ | 重复执行 migrate 不重复应用 |

### 性能基线

| 档位 | 成功率 | P50 | P95 | 说明 |
|------|--------|-----|-----|------|
| 100 并发 | 详见 benchmark_report | — | — | stock_ledger + outbox 双写 |
| 500 并发 | 详见 benchmark_report | — | — | stock_ledger + outbox 双写 |

> 详细数据见 `claude/summaries/stage3_benchmark_report.md`

### 恢复能力验收

| 场景 | 状态 | 说明 |
|------|------|------|
| DB 落盘失败 → outbox 重试 | ✅ | 事件 failed → 修复后重试 sent |
| 分区缺失 → 自动创建 | ✅ | ensure_*_month_partition 可立即修复 |
| 重复请求去重 | ✅ | idempotency_key unique 约束生效 |

---

## 三、风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Redis 与 PG 库存不一致 | 超卖/少卖 | 以 PG 为准，重置 Redis；后续引入 Lua 原子脚本 |
| Outbox 积压 | 落盘延迟 | /internal/db-ops/health 监控 + 告警阈值 |
| 无真实 MQ | outbox 依赖轮询 | 后续接入 NATS/Redis Stream |
| 无分布式锁 | 秒杀场景超卖 | 后续引入 Redlock |
| 归档未自动调度 | 需手动触发 | 后续接入 pg_cron 或应用层定时器 |
| 订单分表无全局 ID 生成器 | 跨分表 ID 可能冲突 | 后续引入 Snowflake/ULID |

---

## 四、上线前检查项 (Checklist)

- [ ] 所有迁移（004~007）在生产 DB 执行成功
- [ ] `stage3:verify` 全部 PASS
- [ ] `ops:maintenance` 建好当月+下月分区
- [ ] Redis `stock:{skuId}` 键已初始化（与 PG skus.stock 一致）
- [ ] PgBouncer 连接池参数已调优
- [ ] 监控告警已配置：outbox pending > 100 / archive_jobs failed
- [ ] 回滚预案已确认（见下方）
- [ ] 应用代码已部署（含 inventory.service / outbox.worker / internal.route）

---

## 五、回滚步骤

### 数据库回滚（逆序）

```bash
# 回滚 007 → 006 → 005 → 004
bun run migrate:down   # 回滚 007（SQL 函数）
bun run migrate:down   # 回滚 006（stock_ledger/outbox/archive_jobs + skus.stock）
bun run migrate:down   # 回滚 005（64 分表 + 分区表 + payments 恢复普通表）
bun run migrate:down   # 回滚 004（products/skus/payments + users 增量字段）
```

### 应用回滚

1. 代码回退到阶段三之前的 commit
2. 重新部署（不含 inventory.service / outbox.worker / internal.route）
3. 验证现有 orders/menu 功能不受影响

### 注意事项

- 回滚 005 时 payments 数据会从分区表迁回普通表（down.sql 已处理）
- 回滚 005 后 64 张订单分表数据将丢失（仅影响新架构数据，历史 orders 表不受影响）
- 建议回滚前先备份：`pg_dump -t 'orders_*' -t payments -t stock_ledger -t outbox_events`

---

## 六、结论

阶段三数据库设计已完成全部 6 步，覆盖：

- **结构完整性**: 核心表 + 分表 + 分区 + 索引 ✅
- **功能闭环**: Redis 预扣 → PG 落盘 → Outbox 重试 ✅
- **生产化**: 自动分区 + 归档 + 清理 + 监控 ✅
- **可恢复**: 故障演练 3 场景全部通过 ✅

**建议: 可进入下一阶段（API 接口设计 / 核心服务实现）。**
