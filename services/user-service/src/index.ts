/**
 * User Service — Hono app 入口 :3001
 * 用户认证、资料管理、地址管理、内部接口
 */
import { Hono } from 'hono';
import { requestId, logger, errorHandler } from '@repo/shared';
import type { AppEnv } from '@repo/shared';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import addressRoutes from './routes/address';
import internalRoutes from './routes/internal';
import adminAuthRoutes from './routes/admin-auth';
import adminManageRoutes from './routes/admin-manage';
import adminUserRoutes from './routes/admin-user';

const app = new Hono<AppEnv>();

// 全局中间件
app.use('*', requestId());
app.use('*', logger());
app.onError(errorHandler);

// 挂载路由
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/user', userRoutes);
app.route('/api/v1/user/address', addressRoutes);
app.route('/api/v1/admin/auth', adminAuthRoutes);
app.route('/api/v1/admin/manage', adminManageRoutes);
app.route('/api/v1/admin/user', adminUserRoutes);
app.route('/internal/user', internalRoutes);

// 健康检查（GET + POST 双支持）
const userHealth = (c: any) => c.json({ status: 'ok', service: 'user-service' });
app.get('/health', userHealth);
app.post('/health', userHealth);

export default {
  port: Number(process.env.USER_SERVICE_PORT) || 3001,
  fetch: app.fetch,
};

// 导出 app 实例供测试使用
export { app };
