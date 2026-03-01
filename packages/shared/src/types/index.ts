/**
 * 全局 TS 类型定义
 * 所有服务共享的通用类型
 */

/** 分页请求参数 */
export interface PaginationInput {
  page: number;
  pageSize: number;
  sort?: string;
  order?: SortOrder;
}

/** 分页元信息 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 分页数据包装 */
export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** 排序方向 */
export type SortOrder = 'asc' | 'desc';

/** 服务上下文 — 挂到 Hono context 上，在请求生命周期内传递 */
export interface ServiceContext {
  userId?: string;
  traceId: string;
}

/** 幂等检查结果 */
export interface IdempotencyResult {
  exists: boolean;
  originalResponse?: unknown;
}

/** 可为 null 的类型 */
export type Nullable<T> = T | null;

/** 通用 ID 类型 */
export type ID = string;
