/**
 * Product Service — 本服务 TS 类型定义
 * 商品、分类、SKU 的输入/输出 DTO
 */

import type { SortOrder } from '@repo/shared';

// ── 分类 ──

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  children: CategoryNode[];
}

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  parentId?: string;
  iconUrl?: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  id: string;
  name?: string;
  slug?: string;
  parentId?: string;
  iconUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

// ── 商品 ──

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  status: string;
  minPrice: string | null;
  maxPrice: string | null;
  totalSales: number;
  avgRating: string;
  reviewCount: number;
  primaryImage: string | null;
  createdAt: Date;
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  brand: string | null;
  status: string;
  attributes: unknown;
  minPrice: string | null;
  maxPrice: string | null;
  totalSales: number;
  avgRating: string;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
  images: ProductImageDTO[];
  skus: SkuDTO[];
  categories: CategoryBasic[];
}

export interface ProductImageDTO {
  id: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface SkuDTO {
  id: string;
  skuCode: string;
  price: string;
  comparePrice: string | null;
  stock: number;
  attributes: Record<string, string> | null;
  status: string;
}

export interface CategoryBasic {
  id: string;
  name: string;
  slug: string;
}

export interface CreateProductInput {
  title: string;
  slug?: string;
  description?: string;
  brand?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  categoryIds: string[];
  images?: {
    url: string;
    altText?: string;
    isPrimary?: boolean;
    sortOrder?: number;
  }[];
}

export interface UpdateProductInput {
  id: string;
  title?: string;
  slug?: string;
  description?: string;
  brand?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  categoryIds?: string[];
  images?: {
    url: string;
    altText?: string;
    isPrimary?: boolean;
    sortOrder?: number;
  }[];
}

// ── SKU ──

export interface CreateSkuInput {
  productId: string;
  skuCode: string;
  price: number;
  comparePrice?: number;
  costPrice?: number;
  stock: number;
  lowStock?: number;
  weight?: number;
  attributes: Record<string, string>;
  barcode?: string;
}

export interface UpdateSkuInput {
  skuId: string;
  price?: number;
  comparePrice?: number;
  costPrice?: number;
  lowStock?: number;
  weight?: number;
  attributes?: Record<string, string>;
  barcode?: string;
  status?: string;
}

// ── 搜索 ──

export interface SearchInput {
  keyword: string;
  categoryId?: string;
  priceMin?: number;
  priceMax?: number;
  sort: string;
  page: number;
  pageSize: number;
}

// ── 列表查询 ──

export interface ProductListInput {
  page: number;
  pageSize: number;
  sort: string;
  order: SortOrder;
  filters?: {
    status?: string;
    categoryId?: string;
    brand?: string;
  };
}

export interface AdminProductListInput extends ProductListInput {
  keyword?: string;
}

// ── 内部接口 ──

export interface SkuBatchItem {
  id: string;
  skuCode: string;
  price: string;
  stock: number;
  status: string;
  attributes: Record<string, string> | null;
  productId: string;
  productTitle: string;
  productSlug: string;
  primaryImage: string | null;
}
