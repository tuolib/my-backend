import { z } from 'zod';
import { AppError } from '@core/error';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().min(1).max(100).default(10),

  // Redis
  REDIS_URL: z.string().url(),

  // Auth
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').filter(Boolean)),
});

/** 环境变量类型 */
export type Env = z.infer<typeof envSchema>;

/** 解析并验证环境变量 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(Bun.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new AppError(500, `Invalid environment variables:\n${details}`, 'ENV_ERROR');
  }
  return result.data;
}
