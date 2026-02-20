import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserService } from './user.service';
import { createUserSchema, updateUserSchema } from './user.schema';
import { z } from 'zod';

const userApp = new Hono();

userApp.post(
  '/register',
  zValidator('json', z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
  })),
  async (c) => {
    try {
      const validated = c.req.valid('json');
      const result = await UserService.create(validated);
      return c.json({ success: true, data: result }, 201);
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 400);
    }
  }
);

// 1. 获取所有用户
userApp.get('/', async (c) => {
  const data = await UserService.findAll();
  return c.json(data);
});

// 2. 创建用户 (带 JSON 校验)
userApp.post('/', zValidator('json', createUserSchema), async (c) => {
  const validated = c.req.valid('json'); // 这里拿到的数据已经是完全类型安全的了
  const user = await UserService.create(validated);
  return c.json(user, 201);
});

// 3. 更新用户 (路径参数 + JSON 校验)
userApp.patch('/:id', zValidator('json', updateUserSchema), async (c) => {
  const id = Number(c.req.param('id'));
  const validated = c.req.valid('json');
  const user = await UserService.update(id, validated);

  if (!user) return c.json({ message: '用户不存在' }, 404);
  return c.json(user);
});

// 4. 删除用户
userApp.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await UserService.delete(id);

  if (!user) return c.json({ message: '用户不存在' }, 404);
  return c.json({ message: '删除成功', user });
});

export default userApp;