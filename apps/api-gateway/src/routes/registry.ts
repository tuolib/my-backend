/**
 * 路由注册表 — 路由前缀 → 下游服务 URL 映射
 * 使用最长前缀匹配，确保 admin/product 优先于 admin
 * Docker 环境中 target 使用 service name，本地用 localhost
 */
import { getConfig } from '@repo/shared';

interface ServiceRoute {
  prefix: string;
  target: string;
}

/** 构建路由注册表（根据环境变量动态生成 target URL） */
function buildRegistry(): ServiceRoute[] {
  const config = getConfig();
  const { userUrl, productUrl, cartUrl, orderUrl } = config.services;

  // 按前缀长度降序排列，确保最长前缀优先匹配
  return [
    // Admin 二级分发（前缀更长，优先匹配）
    { prefix: '/api/v1/admin/product', target: productUrl },
    { prefix: '/api/v1/admin/category', target: productUrl },
    { prefix: '/api/v1/admin/stock', target: productUrl },
    { prefix: '/api/v1/admin/order', target: orderUrl },

    // User Service
    { prefix: '/api/v1/auth', target: userUrl },
    { prefix: '/api/v1/user', target: userUrl },

    // Product Service
    { prefix: '/api/v1/product', target: productUrl },
    { prefix: '/api/v1/category', target: productUrl },
    { prefix: '/api/v1/banner', target: productUrl },

    // Cart Service
    { prefix: '/api/v1/cart', target: cartUrl },

    // Order Service
    { prefix: '/api/v1/order', target: orderUrl },
    { prefix: '/api/v1/payment', target: orderUrl },
  ];
}

let registry: ServiceRoute[] | null = null;

function getRegistry(): ServiceRoute[] {
  if (!registry) {
    registry = buildRegistry();
  }
  return registry;
}

/** 最长前缀匹配，返回目标服务 URL。无匹配返回 null */
export function findTarget(path: string): string | null {
  const routes = getRegistry();
  for (const route of routes) {
    if (path.startsWith(route.prefix)) {
      return route.target;
    }
  }
  return null;
}

/** 暴露 registry 供测试使用 */
export function getRouteRegistry(): ServiceRoute[] {
  return getRegistry();
}
