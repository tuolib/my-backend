/**
 * 分类管理路由 — /api/v1/admin/category/*
 * 需要认证（当前阶段不做 admin 角色检查，预留）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { createCategorySchema, updateCategorySchema } from '../schemas/category.schema';
import { authMiddleware } from '../middleware';
import * as categoryService from '../services/category.service';
import type { CreateCategoryInput, UpdateCategoryInput } from '../types';

const adminCategory = new Hono<AppEnv>();

// 全部路由需要认证
adminCategory.use('/*', authMiddleware);

// POST /api/v1/admin/category/create — 创建分类
adminCategory.post('/create', validate(createCategorySchema), async (c) => {
  const input = c.get('validated') as CreateCategoryInput;
  const result = await categoryService.create(input);
  return c.json(success(result));
});

// POST /api/v1/admin/category/update — 更新分类
adminCategory.post('/update', validate(updateCategorySchema), async (c) => {
  const input = c.get('validated') as UpdateCategoryInput;
  const result = await categoryService.update(input.id, input);
  return c.json(success(result));
});

export default adminCategory;
