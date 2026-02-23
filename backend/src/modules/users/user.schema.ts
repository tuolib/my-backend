import { z } from 'zod';

// 1. 定义一个不含 refine 的基础 Schema
const baseUserSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6个字符'),
  confirmPassword: z.string().min(6, '确认密码至少6个字符'),
});

// 2. 用于创建用户的校验：在基础 Schema 上添加 refine
export const createUserSchema = baseUserSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: '密码和确认密码不匹配',
    path: ['confirmPassword'], // 指定错误关联到 confirmPassword 字段
  }
);

// 3. 用于更新用户的校验：在基础 Schema 上应用 partial
// 这样就避开了在有 refine 的 schema 上使用 partial 的限制
export const updateUserSchema = baseUserSchema.partial().extend({
  // 修正：使用 message 属性来指定自定义错误信息，替代已废弃的 required_error
  id: z.number({ message: '更新操作必须提供用户ID' }).int(),
});

// 删除校验规则：只需要 id
export const deleteUserSchema = z.object({
  id: z.number(),
});

// 推导出 TypeScript 类型供 Service 层使用
export type CreateUserInput = z.infer<typeof createUserSchema>;
