import { Hono } from 'hono'
import { cors } from 'hono/cors'
import postgres from 'postgres'

const app = new Hono()

// 1. 允许 Cloudflare Pages 前端跨域访问
app.use('/*', cors())

// 2. 数据库连接 (环境变量从 docker-compose 传入)
const sql = postgres(process.env.DATABASE_URL!)

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
      message: "Database connected! hono 11"
    })
  } catch (err) {
    return c.json({ success: false, error: err }, 500)
  }
})

export default {
  port: 3000,
  fetch: app.fetch
}