/**
 * 内部路由 — /internal/order/*
 * 服务间调用，不需要 JWT 认证
 * 仅 Docker 内部网络可访问
 * 预留，Step 2 支付等场景使用
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';

const internal = new Hono<AppEnv>();

export default internal;
