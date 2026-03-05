/**
 * 业务错误码枚举
 * 按域分组：User(1xxx), Product(2xxx), Cart(3xxx), Order(4xxx), Gateway(9xxx)
 * 参考 docs/architecture.md 6.2 节
 */
export const ErrorCode = {
  // ── User 域 (1xxx) ──
  USER_NOT_FOUND: 'USER_1001',
  USER_ALREADY_EXISTS: 'USER_1002',
  INVALID_CREDENTIALS: 'USER_1003',
  TOKEN_EXPIRED: 'USER_1004',
  TOKEN_REVOKED: 'USER_1005',
  PASSWORD_TOO_WEAK: 'USER_1006',
  EMAIL_NOT_VERIFIED: 'USER_1007',
  ADDRESS_LIMIT: 'USER_1008',

  // ── Product 域 (2xxx) ──
  PRODUCT_NOT_FOUND: 'PRODUCT_2001',
  SKU_NOT_FOUND: 'PRODUCT_2002',
  STOCK_INSUFFICIENT: 'PRODUCT_2003',
  CATEGORY_NOT_FOUND: 'PRODUCT_2004',
  DUPLICATE_SKU_CODE: 'PRODUCT_2005',
  INVALID_PRICE: 'PRODUCT_2006',
  PRODUCT_UNAVAILABLE: 'PRODUCT_2007',
  IMAGE_NOT_FOUND: 'PRODUCT_2008',
  SKU_DELETE_DENIED: 'PRODUCT_2009',
  CATEGORY_DELETE_DENIED: 'PRODUCT_2010',

  // ── Cart 域 (3xxx) ──
  CART_ITEM_NOT_FOUND: 'CART_3001',
  CART_LIMIT_EXCEEDED: 'CART_3002',
  CART_SKU_UNAVAILABLE: 'CART_3003',
  CART_PRICE_CHANGED: 'CART_3004',

  // ── Order 域 (4xxx) ──
  ORDER_NOT_FOUND: 'ORDER_4001',
  ORDER_STATUS_INVALID: 'ORDER_4002',
  ORDER_EXPIRED: 'ORDER_4003',
  ORDER_ALREADY_PAID: 'ORDER_4004',
  ORDER_CANCEL_DENIED: 'ORDER_4005',
  PAYMENT_FAILED: 'ORDER_4006',
  IDEMPOTENT_CONFLICT: 'ORDER_4007',

  // ── Admin 域 (5xxx) ──
  ADMIN_NOT_FOUND: 'ADMIN_5001',
  ADMIN_INVALID_CREDENTIALS: 'ADMIN_5002',
  ADMIN_ACCOUNT_LOCKED: 'ADMIN_5003',
  ADMIN_ACCOUNT_DISABLED: 'ADMIN_5004',
  ADMIN_MUST_CHANGE_PASSWORD: 'ADMIN_5005',
  ADMIN_PASSWORD_SAME: 'ADMIN_5006',

  // ── Gateway (9xxx) ──
  RATE_LIMITED: 'GATEWAY_9001',
  SERVICE_UNAVAILABLE: 'GATEWAY_9002',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 每个错误码对应的默认中文提示语 */
export const errorMessages: Record<ErrorCode, string> = {
  // User
  [ErrorCode.USER_NOT_FOUND]: '用户不存在',
  [ErrorCode.USER_ALREADY_EXISTS]: '该邮箱已被注册',
  [ErrorCode.INVALID_CREDENTIALS]: '邮箱或密码错误',
  [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [ErrorCode.TOKEN_REVOKED]: '登录凭证已被撤销',
  [ErrorCode.PASSWORD_TOO_WEAK]: '密码强度不足',
  [ErrorCode.EMAIL_NOT_VERIFIED]: '邮箱尚未验证',
  [ErrorCode.ADDRESS_LIMIT]: '收货地址数量已达上限',

  // Product
  [ErrorCode.PRODUCT_NOT_FOUND]: '商品不存在',
  [ErrorCode.SKU_NOT_FOUND]: 'SKU 不存在',
  [ErrorCode.STOCK_INSUFFICIENT]: '库存不足',
  [ErrorCode.CATEGORY_NOT_FOUND]: '分类不存在',
  [ErrorCode.DUPLICATE_SKU_CODE]: 'SKU 编码已存在',
  [ErrorCode.INVALID_PRICE]: '价格无效',
  [ErrorCode.PRODUCT_UNAVAILABLE]: '商品已下架',
  [ErrorCode.IMAGE_NOT_FOUND]: '图片不存在',
  [ErrorCode.SKU_DELETE_DENIED]: 'SKU 删除被拒绝',
  [ErrorCode.CATEGORY_DELETE_DENIED]: '分类删除被拒绝',

  // Cart
  [ErrorCode.CART_ITEM_NOT_FOUND]: '购物车商品不存在',
  [ErrorCode.CART_LIMIT_EXCEEDED]: '购物车商品数量已达上限',
  [ErrorCode.CART_SKU_UNAVAILABLE]: '所选商品已下架',
  [ErrorCode.CART_PRICE_CHANGED]: '商品价格已变动，请确认后重新提交',

  // Order
  [ErrorCode.ORDER_NOT_FOUND]: '订单不存在',
  [ErrorCode.ORDER_STATUS_INVALID]: '订单状态不允许此操作',
  [ErrorCode.ORDER_EXPIRED]: '订单已超时',
  [ErrorCode.ORDER_ALREADY_PAID]: '订单已支付',
  [ErrorCode.ORDER_CANCEL_DENIED]: '已发货订单不可取消',
  [ErrorCode.PAYMENT_FAILED]: '支付失败',
  [ErrorCode.IDEMPOTENT_CONFLICT]: '请勿重复提交',

  // Admin
  [ErrorCode.ADMIN_NOT_FOUND]: '管理员不存在',
  [ErrorCode.ADMIN_INVALID_CREDENTIALS]: '用户名或密码错误',
  [ErrorCode.ADMIN_ACCOUNT_LOCKED]: '账号已锁定，请稍后再试',
  [ErrorCode.ADMIN_ACCOUNT_DISABLED]: '账号已被禁用',
  [ErrorCode.ADMIN_MUST_CHANGE_PASSWORD]: '首次登录需修改密码',
  [ErrorCode.ADMIN_PASSWORD_SAME]: '新密码不能与旧密码相同',

  // Gateway
  [ErrorCode.RATE_LIMITED]: '请求过于频繁，请稍后再试',
  [ErrorCode.SERVICE_UNAVAILABLE]: '服务暂不可用',
};
