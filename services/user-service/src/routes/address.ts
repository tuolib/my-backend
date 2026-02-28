/**
 * 地址管理路由 — /api/v1/user/address/*
 * 全部需要认证
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { createAddressSchema, updateAddressSchema, deleteAddressSchema } from '../schemas/address.schema';
import * as addressService from '../services/address.service';
import { authMiddleware } from '../middleware';
import type { CreateAddressInput, UpdateAddressInput } from '../types';

const address = new Hono<AppEnv>();

address.use('/*', authMiddleware);

// POST /api/v1/user/address/list
address.post('/list', async (c) => {
  const userId = c.get('userId');
  const addresses = await addressService.list(userId);
  return c.json(success(addresses));
});

// POST /api/v1/user/address/create
address.post('/create', validate(createAddressSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.get('validated') as CreateAddressInput;
  const addr = await addressService.create(userId, input);
  return c.json(success(addr));
});

// POST /api/v1/user/address/update
address.post('/update', validate(updateAddressSchema), async (c) => {
  const userId = c.get('userId');
  const input = c.get('validated') as UpdateAddressInput;
  const addr = await addressService.update(userId, input);
  return c.json(success(addr));
});

// POST /api/v1/user/address/delete
address.post('/delete', validate(deleteAddressSchema), async (c) => {
  const userId = c.get('userId');
  const { id } = c.get('validated') as { id: string };
  await addressService.remove(userId, id);
  return c.json(success(null, '地址已删除'));
});

export default address;
