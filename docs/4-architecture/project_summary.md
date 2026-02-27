# 高并发电商架构 — 技术摘要

**技术栈**: Bun + Hono | PostgreSQL | Redis | NATS | Docker | Caddy

---

## 架构拓扑

```
CDN/WAF → Caddy LB x2 → API Gateway x6 → 微服务层 → 数据层
```

9 个微服务：用户 / 商品 / 库存 / 订单 / 支付 / 搜索 / 通知 / 营销 / API GW
通信：同步 REST + 异步 NATS MQ + 支付 Webhook

## API 网关

- 认证：JWT + Redis 黑名单校验
- 限流：IP + UserID 双层令牌桶（Redis DECR）
- 容错：熔断（半开探测）、超时（默认 3s/支付 10s）、GET 幂等重试 1 次
- 统一响应：`{ code, data, message, success }`

## 数据库（PG 4 库）

| 库 | 核心表 | 策略 |
|----|--------|------|
| 用户库 | `users` (phone, pwd_hash, status) | 主从读写分离 |
| 商品库 | `products` + `skus` (JSONB attrs) | Redis 热点缓存 |
| 订单库 | `orders_{0..63}` | user_id % 64 分表，>90天归档按月分区 |
| 支付库 | `payments` | 按月 RANGE 分区，pg_cron 自动建分区 |

日志/审计：按天分区，TTL 30 天后 DETACH + 归档 OSS

## 缓存（Redis Cluster）

| Key | TTL | 用途 |
|-----|-----|------|
| `product:{id}` | 300s + rand(60) | 商品详情，随机偏移防雪崩 |
| `stock:{sku_id}` | 永久 | 库存计数器，DECR 原子预扣 → MQ → PG 落盘 |
| `session:{uid}` | 24h | 会话管理 |
| `bloom:products` | 永久 | 布隆过滤器防穿透 |

ES 结合：ES 返回 ID → Redis MGET → 未命中回源 PG → Pipeline 回填

防雪崩：随机 TTL + singleflight + 降级直查 PG + 大促预热

## 部署（Docker 3+1 节点）

- **Node 1-3**：业务容器各 x2，共 18 容器（512M/0.5CPU）
- **Data Node**：PG 主x1从x2 + Redis x3 + NATS x3 + ES x1（SSD）

蓝绿发布：Green 启动 → /health 通过 → Caddy 切流 → 观察 5min → 销毁 Blue
DB 迁移：向前兼容 + 分步迁移 + down.sql 回滚 + lock_timeout=3s
