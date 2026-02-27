-- 回滚阶段三·第一步

-- 按依赖顺序删除新建表
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS skus;
DROP TABLE IF EXISTS products;

-- 回滚 users 增量变更（不删除 users 表本身）
ALTER TABLE users DROP COLUMN IF EXISTS status;
ALTER TABLE users DROP COLUMN IF EXISTS nickname;

DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
ALTER TABLE users ALTER COLUMN phone SET DEFAULT '';
ALTER TABLE users ALTER COLUMN phone TYPE TEXT;
