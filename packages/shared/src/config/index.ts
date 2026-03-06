/**
 * 环境变量加载 & Zod 校验
 * 所有服务通过 getConfig() 获取类型安全的配置对象
 * 禁止在业务代码中直接使用 process.env
 */
import { z } from 'zod';

// ────────────────────────────── env schema ──────────────────────────────

const envSchema = z.object({
  // ── Server ──
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // ── Service Ports ──
  API_GATEWAY_PORT: z.coerce.number().default(3000),
  USER_SERVICE_PORT: z.coerce.number().default(3001),
  PRODUCT_SERVICE_PORT: z.coerce.number().default(3002),
  CART_SERVICE_PORT: z.coerce.number().default(3003),
  ORDER_SERVICE_PORT: z.coerce.number().default(3004),

  // ── PostgreSQL ──
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().min(1).max(100).default(20),
  DB_POOL_IDLE_TIMEOUT: z.coerce.number().min(0).default(120),

  // ── Redis ──
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_SENTINELS: z.string().default(''),
  REDIS_SENTINEL_MASTER: z.string().default('mymaster'),

  // ── JWT (双 token) ──
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ── 服务间通信 ──
  INTERNAL_SECRET: z.string().min(8).default('dev-internal-secret'),

  // ── CORS ──
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').filter(Boolean)),

  // ── 下游服务 URL（Docker 环境使用容器名） ──
  USER_SERVICE_URL: z.string().optional(),
  PRODUCT_SERVICE_URL: z.string().optional(),
  CART_SERVICE_URL: z.string().optional(),
  ORDER_SERVICE_URL: z.string().optional(),
});

export { envSchema };

/** 环境变量类型 */
export type Env = z.infer<typeof envSchema>;

/** 应用配置类型 */
export interface AppConfig {
  server: {
    env: Env['NODE_ENV'];
    logLevel: Env['LOG_LEVEL'];
    ports: {
      gateway: number;
      user: number;
      product: number;
      cart: number;
      order: number;
    };
  };
  database: {
    url: string;
    poolMax: number;
    poolIdleTimeout: number;
  };
  redis: {
    url: string;
    sentinels: Array<{ host: string; port: number }>;
    sentinelMaster: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  internal: {
    secret: string;
  };
  cors: {
    origins: string[];
  };
  services: {
    userUrl: string;
    productUrl: string;
    cartUrl: string;
    orderUrl: string;
  };
}

/**
 * 解析 process.env 并返回类型安全的配置对象
 * 校验失败时打印详细错误并退出进程
 */
export function getConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`\n❌ Invalid environment variables:\n${details}\n`);
    process.exit(1);
  }

  const env = result.data;

  return {
    server: {
      env: env.NODE_ENV,
      logLevel: env.NODE_ENV === 'production' ? env.LOG_LEVEL : 'debug',
      ports: {
        gateway: env.API_GATEWAY_PORT,
        user: env.USER_SERVICE_PORT,
        product: env.PRODUCT_SERVICE_PORT,
        cart: env.CART_SERVICE_PORT,
        order: env.ORDER_SERVICE_PORT,
      },
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
      sentinels: env.REDIS_SENTINELS
        ? env.REDIS_SENTINELS.split(',').map((s) => {
            const [host, port] = s.trim().split(':');
            return { host, port: parseInt(port || '26379', 10) };
          })
        : [],
      sentinelMaster: env.REDIS_SENTINEL_MASTER,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
    internal: {
      secret: env.INTERNAL_SECRET,
    },
    cors: {
      origins: env.CORS_ORIGINS,
    },
    services: {
      userUrl: env.USER_SERVICE_URL || `http://localhost:${env.USER_SERVICE_PORT}`,
      productUrl: env.PRODUCT_SERVICE_URL || `http://localhost:${env.PRODUCT_SERVICE_PORT}`,
      cartUrl: env.CART_SERVICE_URL || `http://localhost:${env.CART_SERVICE_PORT}`,
      orderUrl: env.ORDER_SERVICE_URL || `http://localhost:${env.ORDER_SERVICE_PORT}`,
    },
  };
}
