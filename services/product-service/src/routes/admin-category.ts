/**
 * 分类管理路由 — /api/v1/admin/category/*
 * 需要后台管理员认证（admin JWT）
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success, paginated } from '@repo/shared';
import {
  createCategorySchema,
  updateCategorySchema,
  adminCategoryListSchema,
  deleteCategorySchema,
} from '../schemas/category.schema';
import { adminAuthMiddleware } from '../middleware';
import * as categoryService from '../services/category.service';
import type { CreateCategoryInput, UpdateCategoryInput, AdminCategoryListInput } from '../types';

const adminCategory = new Hono<AppEnv>();

// 全部路由需要认证
adminCategory.use('/*', adminAuthMiddleware);

// POST /api/v1/admin/category/list — 管理端分类列表（含已禁用）
adminCategory.post('/list', validate(adminCategoryListSchema), async (c) => {
  const input = c.get('validated') as AdminCategoryListInput;
  const { items, total } = await categoryService.getAdminList(input);
  return c.json(paginated(items, {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.ceil(total / input.pageSize),
  }));
});

// POST /api/v1/admin/category/tree — 管理端分类树（含已禁用）
adminCategory.post('/tree', async (c) => {
  const tree = await categoryService.getAdminTree();
  return c.json(success(tree));
});

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

// POST /api/v1/admin/category/delete — 删除分类
adminCategory.post('/delete', validate(deleteCategorySchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  await categoryService.deleteCategory(id);
  return c.json(success(null, '分类已删除'));
});

export default adminCategory;
