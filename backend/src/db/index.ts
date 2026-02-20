import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema'; // 导入你定义的表结构
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// 1. 从环境变量获取连接字符串
// 本地开发通常是: postgres://user:password@localhost:5432/dbname
// Docker 内部部署通常是: postgres://user:password@db:5432/dbname
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set in environment variables');
}

// 2. 创建连接池 (Pool)
// 使用 Pool 而不是 Client，是因为 Hono 接口是并发的，Pool 可以复用连接，性能更高
const pool = new Pool({
  connectionString: databaseUrl,
  // 架构师建议：在生产环境下可以设置最大连接数
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});


// 3. 初始化 Drizzle 实例
// 传入 schema 参数可以让你在查询时获得完美的类型推断（Auto-completion）
export const db = drizzle(pool, { schema });

// 导出 pool 以备某些特殊情况下需要执行原生 SQL 或手动关闭连接
export { pool };

// 封装迁移函数
export const migrateDatabase = async () => {
  console.log('⏳ 正在同步产线数据库表结构...');
  try {
    // 这里的 path 指向你 Git 里的 drizzle 文件夹
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ 数据库同步成功！');
  } catch (error) {
    console.error('❌ 数据库同步失败:', error);
    process.exit(1); // 产线同步失败应停止启动，防止程序崩溃
  }
};