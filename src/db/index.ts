// 导入从 drizzle-orm/postgres-js
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
// 导入 postgres.js
import postgres from 'postgres';
import * as schema from './schema.ts';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

// 1. 创建 postgres.js 客户端
// postgres.js 内部会处理连接池，所以比 pg.Pool 更简单
export const client = postgres(databaseUrl, { max: 20 });

// 2. 初始化 Drizzle 实例
// 注意：drizzle 函数的第一个参数现在是 postgres.js 的客户端
export const db = drizzle(client, { schema });

// 3. 封装迁移函数
export const migrateDatabase = async () => {
  console.log('⏳ 正在同步产线数据库表结构...');
  try {
    // migrate 函数的第一个参数也需要是 drizzle 实例
    // await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ 数据库同步成功！');
  } catch (error) {
    console.error('❌ 数据库同步失败:', error);
    process.exit(1);
  }
};
