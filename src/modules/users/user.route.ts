import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserService } from './user.service.ts';
import { updateUserSchema } from './user.schema.ts';
import { onZodError, ApiResult } from '@/utils/response.ts';

const userRoute = new Hono();

/**
 * GET /api/v1/users?page=1&pageSize=20
 * 分页查询用户列表。
 *
 * page：页码（默认 1，最小 1）
 * pageSize：每页条数（默认 20，最大 100，防止单次查询过大导致 OOM）
 */
userRoute.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') || 20)));
  const data = await UserService.findPaginated(page, pageSize);
  return ApiResult.success(c, data, '成功');
});

// PATCH /api/v1/users/:id — 更新用户（id 从路径取）
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

// DELETE /api/v1/users/:id — 删除用户（id 从路径取）
userRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return ApiResult.error(c, '无效的用户ID', 400);
  const user = await UserService.delete(id);
  if (!user) return ApiResult.error(c, '用户不存在', 404);
  return ApiResult.success(c, user, '删除成功');
});

export default userRoute;
