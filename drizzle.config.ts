import 'dotenv/config'; // 确保能读取到根目录的 .env
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // 1. 告诉 Drizzle 你的 Schema 定义在哪里
  schema: './src/db/schema.ts',

  // 2. 迁移脚本生成的输出目录
  out: './drizzle',

  // 3. 数据库方言和连接配置
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // 4. 严格模式：防止生产环境发生破坏性变更
  strict: true,
  verbose: true,
});