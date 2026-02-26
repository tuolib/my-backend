阶段三：数据库设计

⏺ 基于两份文档，以下是 Postgres 数据库设计：

核心表结构（4 库）

-- ① 用户库
CREATE TABLE users (
id         BIGSERIAL PRIMARY KEY,
phone      VARCHAR(20) UNIQUE NOT NULL,
pwd_hash   VARCHAR(128) NOT NULL,
nickname   VARCHAR(50),
status     SMALLINT DEFAULT 1,
created_at TIMESTAMPTZ DEFAULT now()
);

-- ② 商品库
CREATE TABLE products (
id          BIGSERIAL PRIMARY KEY,
title       VARCHAR(200) NOT NULL,
category_id INT NOT NULL,
price       NUMERIC(12,2) NOT NULL,
status      SMALLINT DEFAULT 1,  -- 上架/下架
created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skus (
id         BIGSERIAL PRIMARY KEY,
product_id BIGINT REFERENCES products(id),
attrs      JSONB,        -- {"颜色":"红","尺码":"XL"}
price      NUMERIC(12,2),
stock      INT DEFAULT 0 -- PG 落盘库存
);

-- ③ 订单库（按 user_id % 64 分表）
CREATE TABLE orders_{0..63} (
id          BIGSERIAL PRIMARY KEY,
user_id     BIGINT NOT NULL,
total       NUMERIC(12,2),
status      SMALLINT DEFAULT 0,  -- 0待付/1已付/2发货/3完成/4取消
created_at  TIMESTAMPTZ DEFAULT now()
);

-- ④ 支付库（独立）
CREATE TABLE payments (
id         BIGSERIAL PRIMARY KEY,
order_id   BIGINT NOT NULL,
channel    VARCHAR(20),  -- alipay/wechat
amount     NUMERIC(12,2),
status     SMALLINT DEFAULT 0,
paid_at    TIMESTAMPTZ
);

日切策略

┌───────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
│   对象    │                                           策略                                           │
├───────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ 订单表    │ 按 user_id % 64 水平分表；冷数据（>90天）归档至 orders_archive 分区表（按月 RANGE 分区） │
├───────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ 支付流水  │ 按月 RANGE 分区 payments_202601，pg_cron 每月自动建分区                                  │
├───────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ 日志/审计 │ 按天分区，TTL 30 天后 DETACH PARTITION + 归档 OSS                                        │
└───────────┴──────────────────────────────────────────────────────────────────────────────────────────┘

缓存交互逻辑

读商品: Client → Redis GET product:{id}
├─ 命中 → 返回
└─ 未命中 → PG 查询 → SET EX 300+rand(60) → 返回
↑ 随机偏移防雪崩

写库存: Redis DECR stock:{sku_id}  ← 原子预扣
├─ ≥0 → MQ → PG UPDATE skus SET stock=stock-1 (异步落盘)
└─ <0 → 售罄拒绝

防穿透: 布隆过滤器拦截不存在的 product_id
防击穿: singleflight / 分布式锁，同一 key 仅一个请求回源