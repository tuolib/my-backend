import { z } from 'zod';
import { AppError } from '../errors/http-errors';

// ────────────────────────────── env schema ──────────────────────────────

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().min(1).max(100).default(20),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().min(0).default(30),

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

// ────────────────────────────── runtime config ──────────────────────────────

/** 运行时配置 */
export interface RuntimeConfig {
  server: {
    name: string;
    port: number;
    env: Env['NODE_ENV'];
  };
  database: {
    url: string;
    poolMax: number;
    poolIdleTimeout: number;
  };
  redis: {
    url: string;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };
  cors: {
    origins: string[];
  };
  log: {
    level: Env['LOG_LEVEL'];
  };
}

/** 从环境变量构建运行时配置 */
export function createRuntimeConfig(env: Env): RuntimeConfig {
  return {
    server: {
      name: 'my-backend',
      port: env.PORT,
      env: env.NODE_ENV,
    },
    database: {
      url: env.DATABASE_URL,
      poolMax:
        env.NODE_ENV === 'production'
          ? env.DB_POOL_MAX
          : Math.min(env.DB_POOL_MAX, 5),
      poolIdleTimeout: env.DB_POOL_IDLE_TIMEOUT,
    },
    redis: {
      url: env.REDIS_URL,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
    },
    cors: {
      origins: env.CORS_ORIGINS,
    },
    log: {
      level: env.NODE_ENV === 'production' ? env.LOG_LEVEL : 'debug',
    },
  };
}
