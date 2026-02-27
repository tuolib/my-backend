-- 阶段三·第一步：核心基础表迁移
-- 非破坏式变更 users；新建 products、skus、payments

-- ========== ① users 表：增量变更 ==========

-- phone 已存在(TEXT NOT NULL DEFAULT '')，改为 VARCHAR(20) 并加唯一索引
ALTER TABLE users ALTER COLUMN phone TYPE VARCHAR(20);
ALTER TABLE users ALTER COLUMN phone DROP DEFAULT;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL AND phone <> '';

-- 新增字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS pwd_hash VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status SMALLINT DEFAULT 1;

-- ========== ② products 商品表 ==========

CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  category_id INT NOT NULL,
  price       NUMERIC(12,2) NOT NULL,
  status      SMALLINT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ========== ③ skus 表 ==========

CREATE TABLE skus (
  id         BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id),
  attrs      JSONB,
  price      NUMERIC(12,2),
  amount     NUMERIC(12,2),
  status     SMALLINT DEFAULT 0,
  paid_at    TIMESTAMPTZ
);

CREATE INDEX idx_skus_product ON skus(product_id);

-- ========== ④ payments 支付表（基础版，暂不分区） ==========

CREATE TABLE payments (
  id       BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  channel  VARCHAR(20),
  amount   NUMERIC(12,2),
  status   SMALLINT DEFAULT 0,
  paid_at  TIMESTAMPTZ
);

CREATE INDEX idx_payments_order ON payments(order_id);
