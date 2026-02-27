/** 可为 null 的类型 */
export type Nullable<T> = T | null;

/** 可选类型（可为 undefined） */
export type Optional<T> = T | undefined;

/** 通用 ID 类型 */
export type ID = string | number;

/** ISO 8601 时间戳字符串 */
export type Timestamp = string;

/** 分页请求参数 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** 分页结果 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
