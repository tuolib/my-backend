# Admin API Reference

> 管理后台所有接口统一通过 API Gateway (`localhost:3000`) 访问。
> 全部使用 **POST** 方法，参数通过 JSON Body 传递。

---

## 认证说明

后台接口使用独立于 C 端的管理员 JWT 认证体系。

- 管理员通过 `/api/v1/admin/auth/login` 获取 `accessToken`
- 后续请求在 Header 中携带：`Authorization: Bearer <accessToken>`
- Token 有效期 2 小时，无 refresh token，过期后重新登录
- JWT 中 `type: 'staff'` 标识后台人员身份，C 端 token 无法访问后台接口

### 权限级别

| 角色 | 说明 |
|------|------|
| `admin` | 全部后台管理权限 |
| `operator` | 日常运营：商品上下架、订单处理 |
| `viewer` | 只读查看 |

超级管理员（`isSuper: true`）额外拥有管理员管理权限。

### 管理员错误码

| 错误码 | 说明 |
|--------|------|
| ADMIN_5001 | 管理员不存在 |
| ADMIN_5002 | 用户名或密码错误 |
| ADMIN_5003 | 账号已锁定（连续 5 次密码错误，锁定 30 分钟） |
| ADMIN_5004 | 账号已被禁用 |
| ADMIN_5005 | 首次登录需修改密码 |
| ADMIN_5006 | 新密码不能与旧密码相同 |

### 内置账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `admin` | `admin` | admin (super) | 首次登录需改密 |

---

## 1. 管理员认证

### POST /api/v1/admin/auth/login

管理员登录。**无需认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**Response Data:**

```typescript
{
  admin: {
    id: string
    username: string
    realName: string | null
    role: string             // "admin" | "operator" | "viewer"
    isSuper: boolean
    status: string
    lastLoginAt: string | null
    createdAt: string
  }
  accessToken: string
  mustChangePassword: boolean  // true 时前端应引导改密
}
```

---

### POST /api/v1/admin/auth/change-password

修改密码（首次登录强制改密 / 主动改密）。**需要管理员认证。**

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| oldPassword | string | 是 | 旧密码 |
| newPassword | string | 是 | 新密码，8-100 字符 |

**Response Data:** `null`，message: `"密码修改成功"`

---

### POST /api/v1/admin/auth/profile

获取当前管理员信息。**需要管理员认证。**

**Request Body:** 空 `{}`

**Response Data:** 同 login 中的 `admin` 对象。

---

## 2. 管理员管理（超级管理员专属）

> 以下接口需要管理员认证 **且** 当前管理员为超级管理员（`isSuper: true`）。
> 非超级管理员调用返回 `403 需要超级管理员权限`。

### POST /api/v1/admin/manage/create

创建管理员。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 2-50 字符，仅允许字母、数字、下划线、短横线 |
| password | string | 是 | 8-100 字符 |
| realName | string | 否 | 最长 50 字符 |
| phone | string | 否 | 最长 20 字符 |
| email | string | 否 | 邮箱格式 |
| role | string | 否 | `admin` \| `operator` \| `viewer`，默认 `operator` |

**Response Data:**

```typescript
{
  id: string
  username: string
  realName: string | null
  role: string
  isSuper: boolean          // 始终为 false
  status: string            // "active"
  phone: string | null
  email: string | null
  lastLoginAt: null
  createdAt: string
}
```

> 新创建的管理员首次登录需修改密码（`mustChangePassword: true`）。

---

### POST /api/v1/admin/manage/list

管理员列表（分页 + 关键词搜索）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-100，默认 20 |
| keyword | string | 否 | 按用户名模糊搜索 |

**Response Data:** 分页结构。

```typescript
{
  items: Array<{
    id: string
    username: string
    realName: string | null
    role: string
    isSuper: boolean
    status: string
    phone: string | null
    email: string | null
    lastLoginAt: string | null
    createdAt: string
  }>
  pagination: { page, pageSize, total, totalPages }
}
```

---

### POST /api/v1/admin/manage/update

更新管理员信息。不能修改超级管理员。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 管理员 ID |
| realName | string | 否 | 最长 50 字符 |
| phone | string | 否 | 最长 20 字符 |
| email | string | 否 | 邮箱格式 |
| role | string | 否 | `admin` \| `operator` \| `viewer` |

**Response Data:** 更新后的管理员对象。

---

### POST /api/v1/admin/manage/toggle-status

启用/禁用管理员。不能禁用超级管理员。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 管理员 ID |
| status | string | 是 | `active` \| `disabled` |

**Response Data:** `null`

---

### POST /api/v1/admin/manage/reset-password

重置管理员密码。不能重置超级管理员密码。重置后该管理员下次登录需修改密码。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 管理员 ID |
| newPassword | string | 是 | 8-100 字符 |

**Response Data:** `null`，message: `"密码已重置，该管理员下次登录需修改密码"`

---

## 3. 商品管理

> 以下接口需要管理员认证。

### POST /api/v1/admin/product/list

管理端商品列表（含 draft/archived，支持筛选排序分页和关键词搜索）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-100，默认 20 |
| sort | string | 否 | `createdAt` \| `price` \| `sales`，默认 `createdAt` |
| order | string | 否 | `asc` \| `desc`，默认 `desc` |
| keyword | string | 否 | 按商品标题模糊搜索，最长 200 字符 |
| filters | object | 否 | 见下 |

`filters` 对象：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | `active` \| `draft` \| `archived` |
| categoryId | string | 否 | 分类 ID（含子分类） |
| brand | string | 否 | 品牌精确匹配 |

**Response Data:** 分页结构。

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
    avgRating: string
    reviewCount: number
    primaryImage: string | null
    createdAt: string
  }>
  pagination: { page, pageSize, total, totalPages }
}
```

---

### POST /api/v1/admin/product/detail

管理端商品详情（含全部 SKU、图片、分类，不走缓存）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |

**Response Data:** 完整商品对象（含 images、skus、categories 数组）。

---

### POST /api/v1/admin/product/toggle-status

上架 / 下架 / 归档。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |
| status | string | 是 | `active` \| `draft` \| `archived` |

**Response Data:** 更新后的商品对象。

---

### POST /api/v1/admin/product/create

创建商品。

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

更新商品。

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

删除商品（软删除）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 商品 ID |

**Response Data:** `null`

---

### POST /api/v1/admin/product/sku/create

创建 SKU。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |
| skuCode | string | 是 | 1-50 字符，唯一 |
| price | number | 是 | 正数 |
| comparePrice | number | 否 | 正数，划线价 |
| costPrice | number | 否 | 正数，成本价 |
| stock | number | 否 | 整数 >=0，默认 0 |
| lowStock | number | 否 | 整数 >=0，默认 5 |
| weight | number | 否 | 重量 |
| attributes | object | 是 | 规格属性，如 `{ "颜色": "红", "尺码": "L" }` |
| barcode | string | 否 | 最长 50 字符 |

**Response Data:** 创建后的 SKU 对象。

---

### POST /api/v1/admin/product/sku/update

更新 SKU。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| price | number | 否 | 正数 |
| comparePrice | number \| null | 否 | 正数或 null |
| costPrice | number \| null | 否 | 正数或 null |
| lowStock | number | 否 | 整数 >=0 |
| weight | number \| null | 否 | |
| attributes | object | 否 | |
| barcode | string \| null | 否 | 最长 50 字符 |
| status | string | 否 | `active` \| `inactive` |

**Response Data:** 更新后的 SKU 对象。

---

### POST /api/v1/admin/product/sku/delete

删除 SKU（同时清除 Redis 库存，更新商品价格区间）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |

**Response Data:** `null`

---

### POST /api/v1/admin/product/image/add

添加商品图片。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |
| images | Array | 是 | 至少 1 张，见下 |

`images` 数组元素：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | 合法 URL |
| altText | string | 否 | 最长 200 字符 |
| isPrimary | boolean | 否 | 是否主图 |
| sortOrder | number | 否 | 排序，不填则自动递增 |

**Response Data:** 更新后的商品对象。

---

### POST /api/v1/admin/product/image/delete

删除商品图片。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| imageId | string | 是 | 图片 ID |

**Response Data:** `null`

---

### POST /api/v1/admin/product/image/sort

图片排序（按传入的 imageIds 数组顺序重新排列）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| productId | string | 是 | 商品 ID |
| imageIds | string[] | 是 | 图片 ID 数组，按期望顺序排列 |

**Response Data:** 更新后的商品对象。

---

## 4. 分类管理

> 以下接口需要管理员认证。

### POST /api/v1/admin/category/create

创建分类。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 1-100 字符 |
| slug | string | 否 | 1-100 字符，不填自动生成 |
| parentId | string | 否 | 父分类 ID |
| iconUrl | string | 否 | 合法 URL |
| sortOrder | number | 否 | 整数 >=0 |

**Response Data:** 创建后的分类对象。

---

### POST /api/v1/admin/category/update

更新分类。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 分类 ID |
| name | string | 否 | 1-100 字符 |
| slug | string | 否 | 1-100 字符 |
| parentId | string \| null | 否 | 父分类 ID 或 null |
| iconUrl | string \| null | 否 | |
| sortOrder | number | 否 | 整数 >=0 |
| isActive | boolean | 否 | |

**Response Data:** 更新后的分类对象。

---

### POST /api/v1/admin/category/list

管理端分类列表（含已禁用分类），支持分页和筛选。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-100，默认 20 |
| keyword | string | 否 | 按名称模糊搜索 |
| isActive | boolean | 否 | 筛选启用/禁用状态 |
| parentId | string \| null | 否 | 按父分类筛选，null 表示顶级分类 |

**Response Data:** 分页结构，包含分类对象数组。

---

### POST /api/v1/admin/category/tree

管理端分类树（含已禁用分类，不走缓存）。

**Request Body:** 无

**Response Data:** 嵌套树形结构，每个节点含 `children` 数组。

---

### POST /api/v1/admin/category/delete

删除分类。当分类下有子分类或关联商品时拒绝删除。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 分类 ID |

**Response Data:** `null`

**错误码：**
- `PRODUCT_2004` — 分类不存在
- `PRODUCT_2010` — 分类删除被拒绝（有子分类或关联商品）

---

## 5. 库存管理

> 以下接口需要管理员认证。

### POST /api/v1/admin/stock/adjust

管理员手动调整库存。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skuId | string | 是 | SKU ID |
| quantity | number | 是 | 整数 >=0，调整后的库存值 |
| reason | string | 否 | 调整原因 |

**Response Data:** `null`

---

## 6. 订单管理

> 以下接口需要管理员认证。

### POST /api/v1/admin/order/list

管理员查看所有订单（分页）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 1-50，默认 10 |
| status | string | 否 | `pending` \| `paid` \| `shipped` \| `delivered` \| `completed` \| `cancelled` \| `refunded` |

**Response Data:** 分页结构，同 C 端 order/list。

---

### POST /api/v1/admin/order/ship

管理员发货。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| trackingNo | string | 否 | 物流单号，最长 100 字符 |

**Response Data:** `null`

---

### POST /api/v1/admin/order/detail

管理端订单详情（含用户信息、收货地址、商品明细、支付记录）。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |

**Response Data:**

```typescript
{
  orderId: string
  orderNo: string
  status: string
  totalAmount: string
  discountAmount: string
  payAmount: string
  remark: string | null
  expiresAt: string
  paidAt: string | null
  shippedAt: string | null
  deliveredAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  userId: string
  user: {                          // 用户基本信息（跨服务获取）
    id: string
    email: string
    nickname: string | null
    phone: string | null
    status: string
  } | null
  items: Array<{                   // 商品明细（快照）
    id: string
    productId: string
    skuId: string
    productTitle: string
    skuAttrs: object
    imageUrl: string | null
    unitPrice: string
    quantity: number
    subtotal: string
  }>
  address: {                       // 收货地址（快照）
    recipient: string
    phone: string
    province: string
    city: string
    district: string
    address: string
    postalCode: string | null
  } | null
  payments: Array<{                // 支付记录
    id: string
    method: string
    amount: string
    status: string
    transactionId: string | null
    createdAt: string
  }>
}
```

---

### POST /api/v1/admin/order/cancel

管理员取消订单（自动释放库存）。仅 `pending` 状态订单可取消。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| reason | string | 否 | 取消原因，最长 500 字 |

**Response Data:** `null`，message: `"订单已取消"`

**错误码：**
- `ORDER_4001` — 订单不存在
- `ORDER_4002` — 订单状态不允许取消

---

### POST /api/v1/admin/order/refund

管理员退款处理。仅 `paid` 状态订单可退款，退款后自动释放库存。

**Request Body:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| orderId | string | 是 | 订单 ID |
| reason | string | 否 | 退款原因，最长 500 字 |

**Response Data:** `null`，message: `"退款成功"`

**错误码：**
- `ORDER_4001` — 订单不存在
- `ORDER_4002` — 订单状态不允许退款（仅 paid → refunded）

---

## 路由转发表

| 前缀 | 下游服务 |
|------|---------|
| `/api/v1/admin/auth` | user-service |
| `/api/v1/admin/manage` | user-service |
| `/api/v1/admin/product` | product-service |
| `/api/v1/admin/category` | product-service |
| `/api/v1/admin/stock` | product-service |
| `/api/v1/admin/order` | order-service |
