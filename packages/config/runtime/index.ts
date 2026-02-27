import type { Env } from "@config/env";

/** 运行时配置 */
export interface RuntimeConfig {
  server: {
    name: string;
    port: number;
    env: Env["NODE_ENV"];
  };
  database: {
    url: string;
    poolSize: number;
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
    level: Env["LOG_LEVEL"];
  };
}

/** 从环境变量构建运行时配置 */
export function createRuntimeConfig(env: Env): RuntimeConfig {
  return {
    server: {
      name: "my-backend",
      port: env.PORT,
      env: env.NODE_ENV,
    },
    database: {
      url: env.DATABASE_URL,
      poolSize:
        env.NODE_ENV === "production"
          ? env.DATABASE_POOL_SIZE
          : Math.min(env.DATABASE_POOL_SIZE, 5),
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
      level: env.NODE_ENV === "production" ? env.LOG_LEVEL : "debug",
    },
  };
}
