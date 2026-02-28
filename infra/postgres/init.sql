-- Docker entrypoint 初始化脚本
-- 创建各服务的 PG schema（迁移脚本也会创建，此处作为安全保障）
CREATE SCHEMA IF NOT EXISTS user_service;
CREATE SCHEMA IF NOT EXISTS product_service;
CREATE SCHEMA IF NOT EXISTS order_service;
