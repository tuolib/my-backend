import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { onZodError } from '../response';

/** Zod 参数校验中间件 — 校验 JSON body */
export function validateBody<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, onZodError);
}

/** Zod 参数校验中间件 — 校验 query 参数 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return zValidator('query', schema, onZodError);
}

/** Zod 参数校验中间件 — 校验 URL params */
export function validateParam<T extends z.ZodType>(schema: T) {
  return zValidator('param', schema, onZodError);
}
