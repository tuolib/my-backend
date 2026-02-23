import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { migrateDatabase } from './db';
import { globalErrorHandler, ApiResult } from './utils/response';
import { connectRedis } from './lib/redis';
import { loginController } from './modules/login/login.controller';
import { authMiddleware } from './middleware/auth';
import userApp from '@/modules/users/user.controller.ts';

// --- 1. 应用初始化 ---
const app = new Hono();

// --- 2. 核心服务连接 ---
// 建议将所有异步初始化操作放在一个函数中
const initializeServices = async (runMigrations = true) => { // 添加一个参数
  try {
    await connectRedis();
    if (runMigrations) { // 根据参数决定是否运行迁移
      await migrateDatabase();
    }
  } catch (error) {
    console.error('❌ 服务初始化失败:', error);
    process.exit(1);
  }
};

// --- 3. 中间件注册 ---
app.use('*', cors()); // 全局跨域
app.onError(globalErrorHandler); // 全局错误处理

// --- 4. 路由定义 ---

// 4.1 公开路由组 (无需登录)
const publicApi = new Hono();
publicApi.route('/account', loginController);
// 未来可以添加注册、获取验证码等路由

// 4.2 保护路由组 (需要登录)
const protectedApi = new Hono();
// 【核心】对整个路由组应用认证中间件
protectedApi.use('*', authMiddleware);
// 未来可以添加其他需要登录的路由
protectedApi.route('/users', userApp);


// --- 5. 路由注册到主应用 ---
// 使用 /api 前缀
app.route('/api', publicApi);
app.route('/api', protectedApi);


// --- 6. 基础路由与 404 ---
app.get('/', (c) => c.text('API is running!'));
app.notFound((c) => ApiResult.error(c, '请求资源不存在', 404));


// 1. 获取命令行参数
// const args = process.argv.slice(2);
// const migrateOnly = args.includes('--migrate-only');

// 2. 执行初始化 (Top-level await)
// 注意：initializeServices 内部已经包含了 migrateDatabase
await initializeServices(true);

// if (migrateOnly) {
//   console.log('✅ 数据库迁移完成，应用退出。');
//   process.exit(0);
// }

console.log('✅ 服务初始化成功');

export default {
  port: 3000,
  hostname: '0.0.0.0', // 确保是 0.0.0.0 供 Docker 访问
  fetch: app.fetch,
};
