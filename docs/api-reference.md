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
    description: string | null
    brand: string | null
    status: string
    attributes: object | null
    createdAt: string
    updatedAt: string
    // 关联字段
    primaryImage: string | null
    minPrice: number | null
    categories: Array<{ id: string, name: string }>
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
    price: number
    comparePrice: number | null
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

## 6. 购物车 Cart

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

## 7. 订单 Order

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

## 8. 支付 Payment

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

## 9. 管理后台 Admin

### POST /api/v1/admin/product/create

创建商品。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 1-200 字符 |
| slug | string | 否 | 1-200 字符，不填自动生成 |
| description | string | 否 | |
| brand | string | 否 | 最长 100 字符 |
| status | string | 否 | `draft` \| `active`，默认 `draft` |
| attributes | object | 否 | 自定义属性 |
| categoryIds | string[] | 是 | 分类 ID 数组，至少 1 个 |
| images | Array | 否 | 见下 |

`images` 数组元素：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 合法 URL |
| altText | string | 否 | 最长 200 字符 |
| isPrimary | boolean | 否 | 是否主图 |
| sortOrder | number | 否 | 排序 |

**Response Data:** 创建后的商品对象。

---

### POST /api/v1/admin/product/update

更新商品。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |
| title | string | 否 | |
| slug | string | 否 | |
| description | string | 否 | |
| brand | string | 否 | |
| status | string | 否 | `draft` \| `active` \| `archived` |
| attributes | object | 否 | |
| categoryIds | string[] | 否 | |
| images | Array | 否 | |

**Response Data:** 更新后的商品对象。

---

### POST /api/v1/admin/product/delete

删除商品（软删除）。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |

**Response Data:** `null`

---

### POST /api/v1/admin/product/sku/create

创建 SKU。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |
| skuCode | string | 是 | 1-50 字符，唯一 |
| price | number | 是 | 正数 |
| comparePrice | number | 否 | 正数，划线价 |
| costPrice | number | 否 | 正数，成本价 |
| stock | number | 否 | 整数 ≥0，默认 0 |
| lowStock | number | 否 | 整数 ≥0，默认 5 |
| weight | number | 否 | 重量 |
| attributes | object | 是 | 规格属性，如 `{ "颜色": "红", "尺码": "L" }` |
| barcode | string | 否 | 最长 50 字符 |

**Response Data:** 创建后的 SKU 对象。

---

### POST /api/v1/admin/product/sku/update

更新 SKU。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| price | number | 否 | 正数 |
| comparePrice | number \| null | 否 | 正数或 null |
| costPrice | number \| null | 否 | 正数或 null |
| lowStock | number | 否 | 整数 ≥0 |
| weight | number \| null | 否 | |
| attributes | object | 否 | |
| barcode | string \| null | 否 | 最长 50 字符 |
| status | string | 否 | `active` \| `inactive` |

**Response Data:** 更新后的 SKU 对象。

---

### POST /api/v1/admin/category/create

创建分类。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 1-100 字符 |
| slug | string | 否 | 1-100 字符，不填自动生成 |
| parentId | string | 否 | 父分类 ID |
| iconUrl | string | 否 | 合法 URL |
| sortOrder | number | 否 | 整数 ≥0 |

**Response Data:** 创建后的分类对象。

---

### POST /api/v1/admin/category/update

更新分类。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 分类 ID |
| name | string | 否 | 1-100 字符 |
| slug | string | 否 | 1-100 字符 |
| parentId | string \| null | 否 | 父分类 ID 或 null |
| iconUrl | string \| null | 否 | |
| sortOrder | number | 否 | 整数 ≥0 |
| isActive | boolean | 否 | |

**Response Data:** 更新后的分类对象。

---

### POST /api/v1/admin/stock/adjust

管理员手动调整库存。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| quantity | number | 是 | 整数 ≥0，调整后的库存值 |
| reason | string | 否 | 调整原因 |

**Response Data:** `null`

---

### POST /api/v1/admin/order/list

管理员查看所有订单（分页）。**需要认证。**

**Request Body:** 同 `/api/v1/order/list`（不含 userId 过滤）。

**Response Data:** 分页结构，同 order/list。

---

### POST /api/v1/admin/order/ship

管理员发货。**需要认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| trackingNo | string | 否 | 物流单号，最长 100 字符 |

**Response Data:** `null`

---

## 10. 内部接口 Internal

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
