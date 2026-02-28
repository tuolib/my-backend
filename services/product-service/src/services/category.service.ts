/**
 * 分类业务逻辑 — 树形结构、缓存、CRUD
 */
import {
  generateId,
  NotFoundError,
  ErrorCode,
} from '@repo/shared';
import * as categoryRepo from '../repositories/category.repo';
import * as cacheService from './cache.service';
import type { CategoryNode, CreateCategoryInput, UpdateCategoryInput } from '../types';
import type { Category } from '@repo/database';

/** 递归组装分类树 */
function buildTree(categories: Category[], parentId: string | null = null): CategoryNode[] {
  return categories
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      iconUrl: c.iconUrl,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      children: buildTree(categories, c.id),
    }));
}

/** 获取分类树（带缓存） */
export async function getTree(): Promise<CategoryNode[]> {
  const cached = await cacheService.getCachedCategoryTree();
  if (cached) return cached;

  const all = await categoryRepo.findAll();
  const tree = buildTree(all);

  await cacheService.setCachedCategoryTree(tree);
  return tree;
}

/** 获取全部分类（平铺） */
export async function getList(): Promise<Category[]> {
  return categoryRepo.findAll();
}

/** 获取分类详情 */
export async function getDetail(categoryId: string): Promise<Category> {
  const cat = await categoryRepo.findById(categoryId);
  if (!cat) {
    throw new NotFoundError('分类不存在', ErrorCode.CATEGORY_NOT_FOUND);
  }
  return cat;
}

/** Admin：创建分类 */
export async function create(input: CreateCategoryInput): Promise<Category> {
  const slug = input.slug || input.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '');

  const cat = await categoryRepo.create({
    id: generateId(),
    name: input.name,
    slug,
    parentId: input.parentId ?? null,
    iconUrl: input.iconUrl ?? null,
    sortOrder: input.sortOrder ?? 0,
  });

  await cacheService.invalidateCategoryTree();
  return cat;
}

/** Admin：更新分类 */
export async function update(categoryId: string, input: UpdateCategoryInput): Promise<Category> {
  const existing = await categoryRepo.findById(categoryId);
  if (!existing) {
    throw new NotFoundError('分类不存在', ErrorCode.CATEGORY_NOT_FOUND);
  }

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.parentId !== undefined) updateData.parentId = input.parentId;
  if (input.iconUrl !== undefined) updateData.iconUrl = input.iconUrl;
  if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  const updated = await categoryRepo.updateById(categoryId, updateData as any);
  if (!updated) {
    throw new NotFoundError('分类不存在', ErrorCode.CATEGORY_NOT_FOUND);
  }

  await cacheService.invalidateCategoryTree();
  return updated;
}
