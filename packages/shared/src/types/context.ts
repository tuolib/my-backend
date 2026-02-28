/**
 * 请求上下文类型定义
 * 用于 Hono 中间件与路由之间传递请求级别信息
 */
import type { Env } from 'hono';
import type { Nullable, ID } from './index';

/** 认证用户信息 */
export interface AuthUser {
  userId: ID;
  role: 'admin' | 'user' | 'guest';
}

/** JWT Payload */
export interface JwtPayload {
  sub: string;
  role: AuthUser['role'];
  iat: number;
  exp: number;
}

/** 请求上下文 */
export interface RequestContext {
  traceId: string;
  requestId: string;
  auth: Nullable<AuthUser>;
  startTime: number;
  clientIp: string;
  userAgent: string;
}

/** Hono 变量绑定类型 */
export interface AppEnv extends Env {
  Variables: {
    requestId: string;
    traceId: string;
    auth: Nullable<AuthUser>;
    requestContext: RequestContext;
  };
}
