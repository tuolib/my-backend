import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { UserService } from './user.service.ts';
import { updateUserSchema, deleteUserSchema } from './user.schema.ts';
import { onZodError, ApiResult } from '@/utils/response.ts';

const userRoute = new Hono();

const listBodySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// POST /api/v1/users/list — 分页查询用户列表
userRoute.post('/list', zValidator('json', listBodySchema, onZodError), async (c) => {
  const { page, pageSize } = c.req.valid('json');
  const data = await UserService.findPaginated(page, pageSize);
  return ApiResult.success(c, data, '成功');
});

// POST /api/v1/users/update — 更新用户（id 从 body 取）
userRoute.post(
  '/update',
  zValidator('json', updateUserSchema, onZodError),
  async (c) => {
    const { id, ...data } = c.req.valid('json');
    const user = await UserService.update(id, data);
    if (!user) return ApiResult.error(c, '用户不存在', 404);
    return ApiResult.success(c, user, '更新成功');
  }
);

// POST /api/v1/users/delete — 删除用户（id 从 body 取）
userRoute.post('/delete', zValidator('json', deleteUserSchema, onZodError), async (c) => {
  const { id } = c.req.valid('json');
  const user = await UserService.delete(id);
  if (!user) return ApiResult.error(c, '用户不存在', 404);
  return ApiResult.success(c, user, '删除成功');
});

export default userRoute;
