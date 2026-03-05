/**
 * Order Service 类型定义
 * 包含请求/响应 DTO 和跨服务数据结构
 */
import type { OrderStatus } from '../state-machine/order-status';

// ────────────────────────────── 请求 DTO ──────────────────────────────

export interface CreateOrderInput {
  items: Array<{
    skuId: string;
    quantity: number;
  }>;
  addressId: string;
  remark?: string;
}

export interface OrderListInput {
  page: number;
  pageSize: number;
  status?: string;
}

export interface OrderDetailInput {
  orderId: string;
}

export interface CancelOrderInput {
  orderId: string;
  reason?: string;
}

export interface ShipOrderInput {
  orderId: string;
  trackingNo?: string;
}

export interface AdminRefundInput {
  orderId: string;
  reason?: string;
}

// ────────────────────────────── 响应 DTO ──────────────────────────────

export interface CreateOrderResult {
  orderId: string;
  orderNo: string;
  payAmount: string;
  expiresAt: Date;
}

export interface OrderListItem {
  orderId: string;
  orderNo: string;
  status: string;
  payAmount: string;
  itemCount: number;
  firstItem: {
    productTitle: string;
    imageUrl: string | null;
    skuAttrs: unknown;
  } | null;
  createdAt: Date;
}

export interface OrderDetailResult {
  orderId: string;
  orderNo: string;
  status: string;
  totalAmount: string;
  discountAmount: string;
  payAmount: string;
  remark: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  items: OrderItemDetail[];
  address: OrderAddressDetail | null;
}

export interface OrderItemDetail {
  id: string;
  productId: string;
  skuId: string;
  productTitle: string;
  skuAttrs: unknown;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  subtotal: string;
}

export interface OrderAddressDetail {
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
  postalCode: string | null;
}

// ────────────────────────────── 管理端 DTO ──────────────────────────────

/** 管理端订单详情（含用户信息 + 支付记录） */
export interface AdminOrderDetailResult extends OrderDetailResult {
  userId: string;
  user: AdminOrderUserInfo | null;
  payments: AdminOrderPayment[];
}

export interface AdminOrderUserInfo {
  id: string;
  email: string;
  nickname: string | null;
  phone: string | null;
  status: string;
}

export interface AdminOrderPayment {
  id: string;
  method: string;
  amount: string;
  status: string;
  transactionId: string | null;
  createdAt: Date;
}

// ────────────────────────────── 支付 DTO ──────────────────────────────

export interface CreatePaymentInput {
  orderId: string;
  method: string;
}

export interface PaymentNotifyInput {
  orderId: string;
  transactionId: string;
  status: 'success' | 'failed';
  amount: number;
  method: string;
  rawData?: Record<string, unknown>;
}

export interface QueryPaymentInput {
  orderId: string;
}

export interface PaymentInfo {
  paymentId: string;
  method: string;
  amount: string;
  payUrl: string;
}

export interface PaymentStatusResult {
  orderId: string;
  orderStatus: string;
  payments: Array<{
    id: string;
    method: string;
    amount: string;
    status: string;
    transactionId: string | null;
    createdAt: Date;
  }>;
}

// ────────────────────────────── 跨服务类型 ──────────────────────────────

/** product-service /internal/product/sku/batch 返回的 SKU 详情 */
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

/** user-service /internal/user/address/detail 返回的地址信息 */
export interface UserAddressDetail {
  id: string;
  userId: string;
  label: string | null;
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
  postalCode: string | null;
  isDefault: boolean;
}
