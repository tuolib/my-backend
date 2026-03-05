/**
 * 请求上下文类型定义
 * 用于 Hono 中间件与路由之间传递请求级别信息
 */
import type { Env } from 'hono';
import type { ID } from './index';

/** 认证用户信息（注入到 context 中的精简结构） */
export interface AuthUser {
  userId: ID;
  email: string;
}

/** Access Token JWT Payload */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Refresh Token JWT Payload */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Admin Access Token JWT Payload */
export interface AdminAccessTokenPayload {
  sub: string;
  username: string;
  role: string;
  isSuper: boolean;
  type: 'staff';
  jti: string;
  iat: number;
  exp: number;
}

/** Hono 变量绑定类型 */
export interface AppEnv extends Env {
  Variables: {
    requestId: string;
    traceId: string;
    userId: string;
    userEmail: string;
    tokenJti: string;
    validated: unknown;
    // Admin context
    adminId: string;
    adminUsername: string;
    adminRole: string;
    adminIsSuper: boolean;
  };
}
