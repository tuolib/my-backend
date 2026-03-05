# API Reference

> 所有接口统一通过 API Gateway (`localhost:3000`) 访问。
> 全部使用 **POST** 方法，参数通过 JSON Body 传递。

---

## 通用约定

### 认证

需要认证的接口必须在请求头中携带：

```
Authorization: Bearer <accessToken>
```

### 幂等性

订单创建、支付发起接口必须携带：

```
X-Idempotency-Key: <unique-string>
```

### 响应格式

```typescript
// 成功
{
  code: 200,
  success: true,
  data: T,
  message: "",
  traceId: string
}

// 失败
{
  code: number,            // HTTP 状态码
  success: false,
  message: string,         // 用户可见提示语
  data: null,
  meta: {
    code: string,          // 业务错误码，如 "USER_NOT_FOUND"
    message: string,       // 开发者可读描述
    details?: unknown      // 可选，校验错误详情等
  },
  traceId: string
}
```

### 分页参数与响应

请求：

```typescript
{
  page: number,      // 从 1 开始，默认 1
  pageSize: number   // 每页条数，默认 10 或 20
}
```

响应 `data` 中包含分页元数据：

```typescript
{
  items: T[],
  pagination: {
    page: number,
    pageSize: number,
    total: number,
    totalPages: number
  }
}
```

### 业务错误码

| 域 | 前缀 | 示例 |
|----|------|------|
| 用户 | 1xxx | USER_1001 ~ USER_1008 |
| 商品 | 2xxx | PRODUCT_2001 ~ PRODUCT_2007 |
| 购物车 | 3xxx | CART_3001 ~ CART_3004 |
| 订单 | 4xxx | ORDER_4001 ~ ORDER_4007 |
| 管理员 | 5xxx | ADMIN_5001 ~ ADMIN_5006 |
| 网关 | 9xxx | GATEWAY_9001 ~ GATEWAY_9002 |

---

## 1. 认证 Auth

### POST /api/v1/auth/register

注册新用户。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱格式 |
| password | string | 是 | 8-100 字符 |
| nickname | string | 否 | 1-50 字符 |

**Response Data:**

```typescript
{
  user: {
    id: string
    email: string
    nickname: string | null
    avatarUrl: string | null
    phone: string | null
    status: string
    lastLogin: string | null
    createdAt: string
    updatedAt: string
  }
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string   // ISO 8601，如 "2026-03-05T10:15:00.000Z"
  refreshTokenExpiresAt: string  // ISO 8601，如 "2026-03-12T10:00:00.000Z"
}
```

---

### POST /api/v1/auth/login

用户登录。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱格式 |
| password | string | 是 | |

**Response Data:** 同 register。

---

### POST /api/v1/auth/refresh

刷新访问令牌。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| refreshToken | string | 是 | |

**Response Data:**

```typescript
{
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  refreshTokenExpiresAt: string
}
```

---

### POST /api/v1/auth/logout

用户登出。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| refreshToken | string | 否 | 传入则吊销该 token |

**Response Data:** `null`

---

## 2. 用户 User

### POST /api/v1/user/profile

获取当前用户信息。**需要认证。**

**Request Body:** 空 `{}`

**Response Data:**

```typescript
{
  id: string
  email: string
  nickname: string | null
  avatarUrl: string | null
  phone: string | null
  status: string
  lastLogin: string | null
  createdAt: string
  updatedAt: string
}
```

---

### POST /api/v1/user/update

更新用户信息。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| nickname | string | 否 | 1-50 字符 |
| avatarUrl | string | 否 | 合法 URL |
| phone | string | 否 | 最长 20 字符 |

**Response Data:** 同 `/api/v1/user/profile`。

---

## 3. 收货地址 Address

### POST /api/v1/user/address/list

获取当前用户的收货地址列表。**需要认证。**

**Request Body:** 空 `{}`

**Response Data:**

```typescript
Array<{
  id: string
  userId: string
  label: string | null
  recipient: string
  phone: string
  province: string
  city: string
  district: string
  address: string
  postalCode: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}>
```

---

### POST /api/v1/user/address/create

新增收货地址。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| label | string | 否 | 最长 50，如"公司"、"家" |
| recipient | string | 是 | 1-100 字符 |
| phone | string | 是 | 1-20 字符 |
| province | string | 是 | 1-50 字符 |
| city | string | 是 | 1-50 字符 |
| district | string | 是 | 1-50 字符 |
| address | string | 是 | 详细地址 |
| postalCode | string | 否 | 最长 10 字符 |
| isDefault | boolean | 否 | 默认 false |

**Response Data:** 单个地址对象（同 list 中的元素）。

---

### POST /api/v1/user/address/update

更新收货地址。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 地址 ID |
| label | string | 否 | |
| recipient | string | 否 | |
| phone | string | 否 | |
| province | string | 否 | |
| city | string | 否 | |
| district | string | 否 | |
| address | string | 否 | |
| postalCode | string | 否 | |
| isDefault | boolean | 否 | |

**Response Data:** 更新后的地址对象。

---

### POST /api/v1/user/address/delete

删除收货地址。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 地址 ID |

**Response Data:** `null`

---

## 4. 商品 Product

### POST /api/v1/product/list

商品列表（分页）。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-100，默认 20 |
| sort | string | 否 | `createdAt` \| `price` \| `sales`，默认 `createdAt` |
| order | string | 否 | `asc` \| `desc`，默认 `desc` |
| filters | object | 否 | 见下 |

`filters` 字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | `active` \| `draft` \| `archived` |
| categoryId | string | 否 | 分类 ID |
| brand | string | 否 | 品牌 |

**Response Data:** 分页结构，`items` 为商品数组。

```typescript
{
  items: Array<{
    id: string
    title: string
    slug: string
    brand: string | null
    status: string
    minPrice: string | null
    maxPrice: string | null
    totalSales: number
    avgRating: string           // 如 "4.5"
    reviewCount: number
    primaryImage: string | null
    createdAt: string
  }>
  pagination: { page, pageSize, total, totalPages }
}
```

---

### POST /api/v1/product/detail

商品详情。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |

**Response Data:**

```typescript
{
  id: string
  title: string
  slug: string
  description: string | null
  brand: string | null
  status: string
  attributes: object | null
  minPrice: string | null
  maxPrice: string | null
  totalSales: number
  avgRating: string             // 如 "4.5"
  reviewCount: number
  createdAt: string
  updatedAt: string
  images: Array<{
    id: string
    url: string
    altText: string | null
    isPrimary: boolean
    sortOrder: number
  }>
  skus: Array<{
    id: string
    skuCode: string
    price: string
    comparePrice: string | null
    stock: number
    attributes: object
    status: string
  }>
  categories: Array<{ id: string, name: string, slug: string }>
}
```

---

### POST /api/v1/product/search

商品搜索。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 是 | 1-200 字符 |
| categoryId | string | 否 | 限定分类 |
| priceMin | number | 否 | 最低价 ≥0 |
| priceMax | number | 否 | 最高价 ≥0 |
| sort | string | 否 | `relevance` \| `price_asc` \| `price_desc` \| `sales` \| `newest`，默认 `relevance` |
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-100，默认 20 |

**Response Data:** 分页结构，同 product/list。

---

### POST /api/v1/product/sku/list

获取指定商品的 SKU 列表。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |

**Response Data:**

```typescript
Array<{
  id: string
  productId: string
  skuCode: string
  price: number
  comparePrice: number | null
  costPrice: number | null
  stock: number
  lowStock: number
  weight: number | null
  attributes: object
  barcode: string | null
  status: string
  createdAt: string
  updatedAt: string
}>
```

---

## 5. 分类 Category

### POST /api/v1/category/list

获取所有分类（扁平列表）。**无需认证。**

**Request Body:** 空 `{}`

**Response Data:**

```typescript
Array<{
  id: string
  name: string
  slug: string
  parentId: string | null
  iconUrl: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}>
```

---

### POST /api/v1/category/tree

获取分类树。**无需认证。**

**Request Body:** 空 `{}`

**Response Data:**

```typescript
Array<{
  id: string
  name: string
  slug: string
  iconUrl: string | null
  sortOrder: number
  isActive: boolean
  children: Array</* 递归同结构 */>
}>
```

---

### POST /api/v1/category/detail

分类详情。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 分类 ID |

**Response Data:** 单个分类对象（同 list 中的元素）。

---

## 6. Banner 轮播图

### POST /api/v1/banner/list

获取活跃的首页轮播图列表。**无需认证。**

**Request Body:** 空 `{}`

**Response Data:**

```typescript
Array<{
  id: string
  title: string
  subtitle: string | null
  imageUrl: string
  linkType: string         // "product" | "category"
  linkValue: string | null // 商品 slug 或分类 slug
  sortOrder: number
  isActive: boolean
  startAt: string | null
  endAt: string | null
  createdAt: string
  updatedAt: string
}>
```

---

## 7. 购物车 Cart

> 所有购物车接口均**需要认证**。

### POST /api/v1/cart/add

添加商品到购物车。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| quantity | number | 是 | 正整数，最大 99 |

**Response Data:** `null`

---

### POST /api/v1/cart/list

获取购物车列表。

**Request Body:** 空 `{}`

**Response Data:**

```typescript
Array<{
  skuId: string
  quantity: number
  selected: boolean
  // 以下为关联 SKU 信息
  productId: string
  productTitle: string
  skuCode: string
  price: number
  comparePrice: number | null
  stock: number
  attributes: object
  imageUrl: string | null
  status: string        // SKU 状态
}>
```

---

### POST /api/v1/cart/update

更新购物车商品数量。数量为 0 时自动移除。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| quantity | number | 是 | 0-99，0 表示移除 |

**Response Data:** `null`

---

### POST /api/v1/cart/remove

批量移除购物车商品。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuIds | string[] | 是 | SKU ID 数组，至少 1 个 |

**Response Data:** `null`

---

### POST /api/v1/cart/clear

清空购物车。

**Request Body:** 空 `{}`

**Response Data:** `null`

---

### POST /api/v1/cart/select

勾选/取消勾选购物车商品（用于结算）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuIds | string[] | 是 | SKU ID 数组，至少 1 个 |
| selected | boolean | 是 | true 勾选，false 取消 |

**Response Data:** `null`

---

### POST /api/v1/cart/checkout/preview

结算预览（已勾选商品的汇总）。

**Request Body:** 空 `{}`

**Response Data:**

```typescript
{
  items: Array<{
    skuId: string
    quantity: number
    productId: string
    productTitle: string
    skuCode: string
    price: number
    attributes: object
    imageUrl: string | null
    subtotal: number
  }>
  totalAmount: number
  totalQuantity: number
}
```

---

## 8. 订单 Order

### POST /api/v1/order/create

创建订单。**需要认证 + 幂等键。**

> 金额由服务端从 SKU 实时获取，前端不传价格。

**Request Headers:**

```
Authorization: Bearer <accessToken>
X-Idempotency-Key: <unique-string>
```

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| items | Array<{ skuId: string, quantity: number }> | 是 | 至少 1 项 |
| addressId | string | 是 | 收货地址 ID |
| remark | string | 否 | 最长 500 字符 |

**Response Data:**

```typescript
{
  id: string
  orderNo: string
  userId: string
  status: string           // "pending"
  totalAmount: number
  payAmount: number
  remark: string | null
  expiredAt: string        // 30 分钟后过期
  createdAt: string
  updatedAt: string
  items: Array<{
    id: string
    skuId: string
    productId: string
    productTitle: string
    skuCode: string
    skuAttributes: object
    imageUrl: string | null
    price: number
    quantity: number
    subtotal: number
  }>
  address: {
    recipient: string
    phone: string
    province: string
    city: string
    district: string
    address: string
    postalCode: string | null
  }
}
```

---

### POST /api/v1/order/list

订单列表（分页）。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-50，默认 10 |
| status | string | 否 | `pending` \| `paid` \| `shipped` \| `delivered` \| `completed` \| `cancelled` \| `refunded` |

**Response Data:** 分页结构，`items` 为订单数组。

---

### POST /api/v1/order/detail

订单详情。**需要认证（仅订单所有者可查）。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |

**Response Data:** 同 order/create 的响应结构。

---

### POST /api/v1/order/cancel

取消订单。**需要认证。**

> 仅 `pending` / `paid` 状态可取消，已发货不可取消。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| reason | string | 否 | 最长 500 字符 |

**Response Data:** `null`

---

## 9. 支付 Payment

### POST /api/v1/payment/create

发起支付。**需要认证 + 幂等键。**

**Request Headers:**

```
Authorization: Bearer <accessToken>
X-Idempotency-Key: <unique-string>
```

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| method | string | 否 | `stripe` \| `alipay` \| `wechat` \| `mock`，默认 `mock` |

**Response Data:**

```typescript
{
  id: string
  orderId: string
  transactionId: string | null
  method: string
  amount: number
  status: string         // "pending"
  createdAt: string
}
```

---

### POST /api/v1/payment/query

查询支付状态。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |

**Response Data:** 支付记录对象。

---

### POST /api/v1/payment/notify

支付回调通知。**无需认证（第三方网关调用）。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| transactionId | string | 是 | 第三方交易号 |
| status | string | 是 | `success` \| `failed` |
| amount | number | 是 | 金额（正数） |
| method | string | 是 | 支付方式 |
| rawData | object | 否 | 原始回调数据 |

**Response Data:** 支付记录对象。

---

## 10. 管理后台 Admin

> 管理后台接口文档已拆分至独立文件，详见 [api-admin.md](./api-admin.md)。

---

## 11. 内部接口 Internal

> 仅 Docker 内部网络可访问，外部请求会被 Gateway 拦截。

### POST /internal/user/detail

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 用户 ID |

### POST /internal/user/batch

| 字段 | 类型 | 说明 |
|------|------|------|
| ids | string[] | 用户 ID 数组 |

### POST /internal/user/address/detail

| 字段 | 类型 | 说明 |
|------|------|------|
| addressId | string | 地址 ID |
| userId | string | 用户 ID |

### POST /internal/product/sku/batch

| 字段 | 类型 | 说明 |
|------|------|------|
| skuIds | string[] | SKU ID 数组 |

### POST /internal/stock/reserve

| 字段 | 类型 | 说明 |
|------|------|------|
| items | Array<{ skuId, quantity }> | 预扣项 |
| orderId | string | 订单 ID |

### POST /internal/stock/release

| 字段 | 类型 | 说明 |
|------|------|------|
| items | Array<{ skuId, quantity }> | 释放项 |
| orderId | string | 订单 ID |

### POST /internal/stock/confirm

| 字段 | 类型 | 说明 |
|------|------|------|
| items | Array<{ skuId, quantity }> | 确认项 |
| orderId | string | 订单 ID |

### POST /internal/stock/sync

| 字段 | 类型 | 说明 |
|------|------|------|
| forceSync | boolean | 是否强制同步，默认 false |

### POST /internal/cart/clear-items

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | string | 用户 ID |
| skuIds | string[] | 要清除的 SKU ID 数组 |
