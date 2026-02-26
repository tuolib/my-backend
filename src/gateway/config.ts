import type { GatewayConfig } from './types.ts';

/**
 * 网关集中配置
 *
 * 所有下游路由、超时、重试、限流、熔断参数集中管理。
 * 后续可替换为远程配置中心或环境变量覆盖。
 */
export const gatewayConfig: GatewayConfig = {
  services: [
    // TODO: 阶段二后续步骤 — 添加代理转发时启用
    // {
    //   prefix: '/api/v1/users',
    //   upstream: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    //   timeout: 3000,
    //   retryEnabled: true,
    //   retryMax: 1,
    //   authRequired: true,
    // },
    // {
    //   prefix: '/api/v1/orders',
    //   upstream: process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
    //   timeout: 3000,
    //   retryEnabled: true,
    //   retryMax: 1,
    //   authRequired: true,
    // },
    // {
    //   prefix: '/api/v1/payments',
    //   upstream: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
    //   timeout: 10000,  // 支付服务超时更长
    //   retryEnabled: false,  // 非幂等，不重试
    //   retryMax: 0,
    //   authRequired: true,
    // },
  ],

  auth: {
    enabled: false, // TODO: 认证步骤启用
    jwtBlacklistPrefix: 'jwt:blacklist:',
  },

  rateLimit: {
    enabled: false, // TODO: 限流步骤启用
    maxRequests: 100,
    windowSeconds: 60,
  },

  circuitBreaker: {
    enabled: false, // TODO: 熔断步骤启用
    failureThreshold: 5,
    resetTimeout: 5000,
  },

  healthCheck: {
    livenessPath: '/health',
    readinessPath: '/ready',
    readinessTimeout: 3000,
  },

  gracefulShutdownTimeout: 30_000,
};
