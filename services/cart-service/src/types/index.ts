/**
 * Cart Service — TS 类型定义
 * 购物车的输入/输出 DTO、Redis 存储结构
 */

// ── 输入类型 ──

export interface AddCartInput {
  skuId: string;
  quantity: number;
}

export interface UpdateCartInput {
  skuId: string;
  quantity: number;
}

export interface RemoveCartInput {
  skuIds: string[];
}

export interface SelectCartInput {
  skuIds: string[];
  selected: boolean;
}

export interface ClearItemsInput {
  userId: string;
  skuIds: string[];
}

// ── Redis 存储结构 ──

export interface CartItemSnapshot {
  productId: string;
  productTitle: string;
  skuAttrs: Record<string, string> | null;
  price: string;
  imageUrl: string | null;
}

export interface CartItem {
  skuId: string;
  quantity: number;
  selected: boolean;
  addedAt: string;
  snapshot: CartItemSnapshot;
}

// ── 输出类型 ──

export interface CartListItem extends CartItem {
  currentPrice: string;
  currentStock: number;
  priceChanged: boolean;
  unavailable: boolean;
  stockInsufficient: boolean;
}

// ── 结算预览 ──

export interface CheckoutPreviewItem {
  skuId: string;
  quantity: number;
  currentPrice: string;
  currentStock: number;
  productId: string;
  productTitle: string;
  skuAttrs: Record<string, string> | null;
  imageUrl: string | null;
}

export interface PriceChangedItem {
  skuId: string;
  productTitle: string;
  oldPrice: string;
  newPrice: string;
}

export interface InsufficientItem {
  skuId: string;
  productTitle: string;
  requested: number;
  available: number;
}

export interface UnavailableItem {
  skuId: string;
  productTitle: string;
}

export interface CheckoutSummary {
  itemsTotal: string;
  shippingFee: string;
  discountAmount: string;
  payAmount: string;
}

export interface CheckoutWarnings {
  unavailableItems: UnavailableItem[];
  priceChangedItems: PriceChangedItem[];
  insufficientItems: InsufficientItem[];
}

export interface CheckoutPreview {
  items: CheckoutPreviewItem[];
  summary: CheckoutSummary;
  warnings: CheckoutWarnings;
  canCheckout: boolean;
}

// ── Product Service 客户端类型 ──

export interface SkuDetail {
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
