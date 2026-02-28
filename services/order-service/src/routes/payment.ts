/**
 * 支付路由 — /api/v1/payment/*
 * create/query 需要认证，notify 是公开接口（三方回调）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { authMiddleware } from '../middleware';
import * as paymentService from '../services/payment.service';
import {
  createPaymentSchema,
  paymentNotifySchema,
  queryPaymentSchema,
} from '../schemas/payment.schema';
import type { CreatePaymentInput, PaymentNotifyInput, QueryPaymentInput } from '../types';

const payment = new Hono<AppEnv>();

// POST /api/v1/payment/create — 发起支付（需要认证）
payment.post('/create', authMiddleware, validate(createPaymentSchema), async (c) => {
  const userId = c.get('userId');
  const { orderId, method } = c.get('validated') as CreatePaymentInput;
  const result = await paymentService.createPayment(userId, orderId, method);
  return c.json(success(result, '支付发起成功'));
});

// POST /api/v1/payment/notify — 支付回调（公开，三方调用，需签名验证 TODO）
payment.post('/notify', validate(paymentNotifySchema), async (c) => {
  const body = c.get('validated') as PaymentNotifyInput;
  const result = await paymentService.handleNotify(body);
  return c.json(success(result));
});

// POST /api/v1/payment/query — 查询支付状态（需要认证）
payment.post('/query', authMiddleware, validate(queryPaymentSchema), async (c) => {
  const userId = c.get('userId');
  const { orderId } = c.get('validated') as QueryPaymentInput;
  const result = await paymentService.queryPayment(userId, orderId);
  return c.json(success(result));
});

export default payment;
