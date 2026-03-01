-- 自定义索引（architecture.md 3.6）
-- Drizzle 不支持条件索引、GIN 索引、全文搜索索引，需手动创建

-- User Service: 条件索引
CREATE INDEX IF NOT EXISTS idx_users_status_active ON user_service.users(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON user_service.refresh_tokens(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_active ON user_service.refresh_tokens(expires_at)
  WHERE revoked_at IS NULL;

-- Product Service: 条件索引
CREATE INDEX IF NOT EXISTS idx_products_status_active ON product_service.products(status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_brand_active ON product_service.products(brand)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_sales ON product_service.products(total_sales DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_skus_stock_low ON product_service.skus(product_id)
  WHERE stock <= low_stock AND status = 'active';

-- Product Service: GIN 索引
CREATE INDEX IF NOT EXISTS idx_products_fulltext ON product_service.products
  USING GIN(to_tsvector('simple', title || ' ' || coalesce(description, '') || ' ' || coalesce(brand, '')));
CREATE INDEX IF NOT EXISTS idx_products_attrs ON product_service.products USING GIN(attributes);

-- Order Service: 条件索引
CREATE INDEX IF NOT EXISTS idx_orders_expires ON order_service.orders(expires_at)
  WHERE status = 'pending';
