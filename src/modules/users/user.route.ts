import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserService } from './user.service.ts';
import { updateUserSchema } from './user.schema.ts';
import { onZodError, ApiResult } from '@/utils/response.ts';

const userRoute = new Hono();

// GET /api/users — 获取所有用户
userRoute.get('/', async (c) => {
  const data = await UserService.findAll();
  return ApiResult.success(c, data, '成功');
});

// PATCH /api/users/:id — 更新用户（id 从路径参数取）
userRoute.patch(
  '/:id',
  zValidator('json', updateUserSchema.omit({ id: true }), onZodError),
  async (c) => {
    const id = Number(c.req.param('id'));
    if (isNaN(id)) return ApiResult.error(c, '无效的用户ID', 400);
    const data = c.req.valid('json');
    const user = await UserService.update(id, data);
    if (!user) return ApiResult.error(c, '用户不存在', 404);
    return ApiResult.success(c, user, '更新成功');
  }
);

// DELETE /api/users/:id — 删除用户（id 从路径参数取）
userRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return ApiResult.error(c, '无效的用户ID', 400);
  const user = await UserService.delete(id);
  if (!user) return ApiResult.error(c, '用户不存在', 404);
  return ApiResult.success(c, user, '删除成功');
});

export default userRoute;
