/**
 * 分类公开路由 — /api/v1/category/*
 * 无需认证，面向前端消费者
 */
import { Hono } from 'hono';
import type { AppEnv } from '@repo/shared';
import { validate, success } from '@repo/shared';
import { categoryDetailSchema } from '../schemas/category.schema';
import * as categoryService from '../services/category.service';

const category = new Hono<AppEnv>();

// POST /api/v1/category/list — 全部分类（平铺）
category.post('/list', async (c) => {
  const list = await categoryService.getList();
  return c.json(success(list));
});

// POST /api/v1/category/tree — 分类树
category.post('/tree', async (c) => {
  const tree = await categoryService.getTree();
  return c.json(success(tree));
});

// POST /api/v1/category/detail — 分类详情
category.post('/detail', validate(categoryDetailSchema), async (c) => {
  const { id } = c.get('validated') as { id: string };
  const detail = await categoryService.getDetail(id);
  return c.json(success(detail));
});

export default category;
