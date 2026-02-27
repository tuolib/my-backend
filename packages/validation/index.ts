import { z } from "zod";

/** ========== 通用基础校验规则 ========== */

/** 非空字符串 */
export const nonEmptyString = (field: string) =>
  z.string().min(1, `${field} 不能为空`);

/** ID 校验（正整数） */
export const idSchema = z.coerce
  .number()
  .int()
  .positive("ID 必须为正整数");

/** UUID 校验 */
export const uuidSchema = z.string().uuid("无效的 UUID 格式");

/** 邮箱校验 */
export const emailSchema = z.string().email("邮箱格式不正确");

/** 手机号校验（中国大陆） */
export const phoneSchema = z
  .string()
  .regex(/^1[3-9]\d{9}$/, "手机号格式不正确");

/** 密码校验（至少 8 位，包含大小写字母和数字） */
export const passwordSchema = z
  .string()
  .min(8, "密码不少于 8 位")
  .regex(/[a-z]/, "密码需包含小写字母")
  .regex(/[A-Z]/, "密码需包含大写字母")
  .regex(/\d/, "密码需包含数字");

/** ========== 分页参数校验 ========== */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** ========== 金额校验 ========== */

/** 金额（正数，最多两位小数） */
export const amountSchema = z.coerce
  .number()
  .positive("金额必须为正数")
  .multipleOf(0.01, "金额最多两位小数");

/** ========== 日期时间校验 ========== */

/** ISO 8601 日期时间 */
export const isoDateSchema = z.string().datetime("日期格式不正确");

/** 日期范围查询 */
export const dateRangeSchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine((d) => new Date(d.startDate) < new Date(d.endDate), {
    message: "开始日期必须早于结束日期",
  });

/** ========== 工具函数 ========== */

/** 提取 Zod schema 的类型 */
export type InferSchema<T extends z.ZodType> = z.infer<T>;

/** 创建带 body 的 POST 请求 schema */
export function createBodySchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape);
}
