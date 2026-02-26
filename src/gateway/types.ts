/**
 * API 网关类型定义
 * 为认证、限流、代理、熔断预留扩展点
 */

/** 下游服务路由映射 */
export type ServiceRoute = {
  /** 网关匹配前缀，如 /api/v1/users */
  prefix: string;
  /** 下游服务地址，如 http://user-service:3000 */
  upstream: string;
  /** 请求超时 (ms) */
  timeout: number;
  /** 是否启用重试 (仅 GET 幂等请求) */
  retryEnabled: boolean;
  /** 最大重试次数 */
  retryMax: number;
  /** 是否需要认证 */
  authRequired: boolean;
};

/** 限流配置 */
export type RateLimitConfig = {
  enabled: boolean;
  /** 每窗口最大请求数 */
  maxRequests: number;
  /** 窗口大小 (秒) */
  windowSeconds: number;
};

/** 熔断器配置 */
export type CircuitBreakerConfig = {
  enabled: boolean;
  /** 连续失败 N 次后熔断 */
  failureThreshold: number;
  /** 熔断持续时间 (ms)，之后进入半开状态 */
  resetTimeout: number;
};

/** 健康检查配置 */
export type HealthCheckConfig = {
  /** /health 端点路径 */
  livenessPath: string;
  /** /ready 端点路径 */
  readinessPath: string;
  /** 就绪检查超时 (ms) */
  readinessTimeout: number;
};

/** 网关完整配置 */
export type GatewayConfig = {
  services: ServiceRoute[];
  rateLimit: RateLimitConfig;
  circuitBreaker: CircuitBreakerConfig;
  healthCheck: HealthCheckConfig;
  /** 优雅关闭等待时间 (ms) */
  gracefulShutdownTimeout: number;
};
