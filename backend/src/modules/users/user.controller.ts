import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { UserService } from './user.service';
import { createUserSchema, updateUserSchema, deleteUserSchema } from './user.schema';
import { onZodError, ApiResult } from "../../utils/response.ts";
import { parseDbError } from "../../utils/db-error.ts";

const userApp = new Hono();

// 1. 获取所有用户
userApp.post('/getAllUser', async (c) => {
  try {
    const data = await UserService.findAll();
    return ApiResult.success(c, data, "成功");
  } catch (e) {
    // 这里抛出的任何错误都会被全局 globalErrorHandler 捕获并包装
    throw new Error("数据库操作异常");
  }
});

// 2. 创建用户 (带 JSON 校验)
userApp.post(
  '/register',
  zValidator('json', createUserSchema, onZodError),
  async (c) => {
    try {
      const validated = c.req.valid('json');
      const data = await UserService.create(validated);
      return ApiResult.success(c, data, "成功");
    } catch (e) {
      // 1. 处理数据库唯一约束冲突 (例如: email 已存在)
      // PostgreSQL error code 23505: unique_violation
      const { errorCode } = parseDbError(e);
      if (errorCode == '23505') {
        return ApiResult.error(c, "该邮箱已被注册，请更换邮箱", 409); // 409 Conflict
      }

      // 3. 最后才抛给全局错误处理器
      // 这里抛出的任何错误都会被全局 globalErrorHandler 捕获并包装
      throw new Error("服务器繁忙，请稍后再试");
    }
  }
);

// 3. 更新用户 (路径参数 + JSON 校验)
userApp.post('/update', zValidator('json', updateUserSchema, onZodError), async (c) => {
  // const id = Number(c.req.param('id'));
  // const validated = c.req.valid('json');
  const { id, ...data } = c.req.valid('json'); // 解构出 id 和剩余数据
  try {
    const user = await UserService.update(id, data);
    if (!user) {
      return ApiResult.error(c, "用户不存在", 404);
    }
    return ApiResult.success(c, user, "更新成功");
  } catch (e) {
    // 这里抛出的任何错误都会被全局 globalErrorHandler 捕获并包装
    throw new Error("数据库操作异常");
  }
});

// 4. 删除用户
userApp.post('/delete', zValidator('json', deleteUserSchema), async (c) => {
  // const id = Number(c.req.param('id'));
  const { id } = c.req.valid('json');
  try {
    const user = await UserService.delete(id);
    if (!user) {
      return ApiResult.error(c, "用户不存在", 404);
    }
    return ApiResult.success(c, user, "更新成功");
  } catch (e) {
    // 这里抛出的任何错误都会被全局 globalErrorHandler 捕获并包装
    throw new Error("数据库操作异常");
  }
});

export default userApp;