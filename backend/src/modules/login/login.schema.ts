import { z } from 'zod';

// 架构师建议：将校验逻辑与错误信息分离，使代码更清晰
const errorMessages = {
  email: {
    invalidType: '邮箱必须是字符串',
    invalidFormat: '邮箱格式不正确',
  },
  password: {
    invalidType: '密码必须是字符串',
    tooShort: '密码至少需要6个字符',
  },
};

/**
 * 登录接口的输入校验 Schema。
 * 使用 Zod 进行严格的类型和格式校验，这是保证 API 健壮性的第一步。
 */
export const loginBodySchema = z.object({
  email: z
    .string({ message: errorMessages.email.invalidType })
    .email({ message: errorMessages.email.invalidFormat }),
  password: z
    .string({ message: errorMessages.password.invalidType })
    .min(6, errorMessages.password.tooShort),
});

// 从 Zod Schema 推断出 TypeScript 类型，避免手动维护类型定义
export type LoginInput = z.infer<typeof loginBodySchema>;
