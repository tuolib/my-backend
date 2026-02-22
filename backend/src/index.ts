import { Hono } from 'hono'
import { cors } from 'hono/cors'
import postgres from 'postgres'
import userApp from './modules/users/user.controller';
import { migrateDatabase } from "./db";
import type { ApiResponse } from "./middleware/api.ts";
import { globalErrorHandler } from "./utils/response.ts";

const app = new Hono()

// 1. 允许 Cloudflare Pages 前端跨域访问
app.use('/*', cors())

// 2. 数据库连接 (环境变量从 docker-compose 传入)
const sql = postgres(process.env.DATABASE_URL!)
console.log("🛠️ Current DATABASE_URL:", process.env.DATABASE_URL);

// 注册全局错误处理
app.onError(globalErrorHandler);

// 统一路由前缀
app.route('/api/users', userApp);


// 3. 基础路由
app.get('/', (c) => c.text('Hono API is running on Hetzner!'))

// 4. 一个简单的数据库查询接口
app.get('/db-test', async (c) => {
  try {
    // 执行一个简单的 SQL
    const result = await sql`SELECT NOW() as now`
    return c.json({ 
      success: true, 
      server_time: result[0].now,
      message: "Database connected!" 
    })
  } catch (err) {
    return c.json({ success: false, error: err }, 500)
  }
})

// 4. 一个简单的数据库查询接口
app.get('/db-test-b', async (c) => {
  try {
    // 执行一个简单的 SQL
    const result = await sql`SELECT NOW() as now`
    return c.json({
      success: true,
      server_time: result[0].now,
      message: "Database connected! hono 11 2 3"
    })
  } catch (err) {
    return c.json({ success: false, error: err }, 500)
  }
})

// 4. 404 处理器 (通常放在最后)
app.notFound((c) => {
  return c.json({
    code: 404,
    success: false,
    message: "请求资源不存在",
    data: null
  }, 404);
});

await migrateDatabase(); // 确保数据库先就绪
export default {
  port: 3000,
  fetch: app.fetch
}