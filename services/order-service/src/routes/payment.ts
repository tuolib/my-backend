/**
 * 支付路由 — /api/v1/payment/*
 * Step 2 实现支付发起、回调、查询
 * 当前占位空路由
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';

const payment = new Hono<AppEnv>();

export default payment;
