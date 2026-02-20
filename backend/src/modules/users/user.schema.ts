import { z } from 'zod';

// 用于创建用户的校验
export const createUserSchema = z.object({
  name: z.string().min(2, "名字至少2个字符"),
  email: z.string().email("邮箱格式不正确"),
  age: z.number().int().positive().optional(),
});

// 用于更新用户的校验（所有字段可选）
export const updateUserSchema = createUserSchema.partial();

// 推导出 TypeScript 类型供 Service 层使用
export type CreateUserInput = z.infer<typeof createUserSchema>;