/**
 * 公开路由白名单 — 不需要 JWT 认证的路由路径
 * 新增公开路由只需在 PUBLIC_ROUTES 数组中添加一行
 */

export const PUBLIC_ROUTES: string[] = [
  // 认证
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',

  // 商品浏览（公开）
  '/api/v1/product/list',
  '/api/v1/product/detail',
  '/api/v1/product/search',
  '/api/v1/product/sku/list',

  // 分类（公开）
  '/api/v1/category/list',
  '/api/v1/category/detail',
  '/api/v1/category/tree',

  // Banner 轮播图（公开）
  '/api/v1/banner/list',

  // 管理员登录（公开，无需 C 端 JWT）
  '/api/v1/admin/auth/login',

  // 支付回调（三方调用，签名验证而非 JWT）
  '/api/v1/payment/notify',

  // 健康检查
  '/health',
  '/health/live',
];

/**
 * Admin 路由前缀 — 跳过 C 端 JWT 鉴权
 * Admin 路由使用独立的 admin JWT 体系，由下游服务自行验证
 */
const ADMIN_ROUTE_PREFIX = '/api/v1/admin/';

/** 判断路径是否无需 C 端 JWT 认证（公开路由 或 admin 路由） */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.includes(path) || path.startsWith(ADMIN_ROUTE_PREFIX);
}
