# Admin 后台系统 -- 架构设计与开发路线图

---

## 1. 系统定位

后台管理系统（Admin Portal）是面向运营团队的内部工具，用于管理电商平台的商品、订单、用户等核心业务数据。

**核心原则：按业务域管理，不按前后台拆服务。**

后台不是一个独立服务，而是各域服务暴露的管理接口集合。每个域服务同时服务 C 端和后台，通过不同的认证体系和路由前缀隔离。这与 Amazon 的 "two-pizza team" 模型一致 -- 每个团队拥有一个服务，对外暴露 C 端 API，对内暴露管理 API。

---

## 2. 整体架构

```
                          +------------------+
                          |   Admin 前端      |
                          +--------+---------+
                                   |
                          Authorization: Bearer <staff JWT>
                                   |
                          +--------v---------+
                          |   API Gateway    |
                          |   (Caddy:443)    |
                          +--------+---------+
                                   |
                    /api/v1/admin/* 前缀路由分发
                                   |
            +----------------------+----------------------+
            |                      |                      |
   +--------v--------+   +--------v--------+   +---------v-------+
   |  user-service    |   | product-service |   |  order-service  |
   |  :3001           |   |  :3002          |   |  :3004          |
   |                  |   |                 |   |                 |
   | - admin auth     |   | - 商品 CRUD     |   | - 订单列表/详情  |
   | - admin manage   |   | - 分类 CRUD     |   | - 发货/取消/退款 |
   | - user manage    |   | - 库存调整      |   |                 |
   +--------+---------+   +--------+--------+   +--------+-------+
            |                      |                      |
            +----------------------+----------------------+
                                   |
                    +-----------------------------+
                    |  PostgreSQL                  |
                    |  admin_service.admins        |  <-- 独立
                    |  user_service.*              |  <-- 共用
                    |  product_service.*           |  <-- 共用
                    |  order_service.*             |  <-- 共用
                    +-----------------------------+
```

---

## 3. 数据架构

### 3.1 身份体系：独立

管理员与 C 端用户完全分离，各自独立的表、登录方式、JWT 体系。

| 维度 | 管理员 (admin) | C 端用户 (user) |
|------|---------------|----------------|
| 表 | `admin_service.admins` | `user_service.users` |
| 登录凭证 | username + password | email + password |
| JWT 标识 | `type: 'staff'` | 无 type 字段 |
| Token 有效期 | 2h，无 refresh token | 15m access + 7d refresh |
| 账号来源 | super admin 创建 | 用户自助注册 |

**为什么分离：**
- 管理员是内部人员，不走自助注册流程
- 两套体系的安全策略不同（后台更严格）
- 避免权限提升漏洞（C 端用户永远无法获得后台权限）

### 3.2 业务数据：共用

后台操作的就是 C 端的数据。分表会引入数据同步复杂度，没有收益。

| 数据 | Schema | 后台权限 | C 端权限 |
|------|--------|---------|---------|
| 商品/分类/SKU | `product_service` | 全量读写 | 只读（仅 active 状态） |
| 订单/支付 | `order_service` | 全量只读 + 发货/取消/退款 | 本人订单读写 |
| 用户/地址 | `user_service` | 全量只读 + 封禁/解封 | 本人数据读写 |
| 管理员 | `admin_service` | super admin 全量读写 | 不可访问 |

### 3.3 admins 表结构

```sql
admin_service.admins
  id                  varchar(21)  PK      -- nanoid
  username            varchar(50)  UNIQUE  -- 登录凭证
  password            varchar(255)         -- bcrypt hash
  real_name           varchar(50)          -- 真实姓名
  phone               varchar(20)
  email               varchar(255)
  role                varchar(20)          -- admin | operator | viewer
  is_super            boolean              -- 超级管理员标记
  status              varchar(20)          -- active | disabled
  must_change_password boolean             -- 首次登录强制改密
  last_login_at       timestamptz
  login_fail_count    integer              -- 连续失败次数
  locked_until        timestamptz          -- 锁定到期时间
  created_at          timestamptz
  updated_at          timestamptz
```

---

## 4. 认证与鉴权架构

### 4.1 JWT 设计

Admin JWT Payload：

```json
{
  "sub": "admin-nanoid-21",
  "username": "zhangsan",
  "role": "admin",
  "isSuper": false,
  "type": "staff",        // 关键：区分 C 端和后台
  "jti": "unique-token-id",
  "iat": 1709625600,
  "exp": 1709632800       // 2h 后过期
}
```

`type` 和 `role` 的职责明确分离：
- `type: 'staff'` -- **身份**，这个 token 属于后台系统
- `role: 'admin'` -- **权限**，这个人在后台的角色

### 4.2 中间件链

```
请求进入
  |
  v
adminAuthMiddleware        -- 验证 JWT，检查 type === 'staff'
  |                           设置 adminId / adminUsername / adminRole / adminIsSuper
  v
requireSuperAdmin (可选)   -- 检查 isSuper === true（仅管理员管理接口）
  |
  v
validate(schema)           -- Zod 参数校验
  |
  v
route handler              -- 业务逻辑
```

### 4.3 安全策略

| 策略 | 实现 |
|------|------|
| 身份隔离 | C 端 token 无 `type` 字段，`verifyAdminAccessToken` 检查 `type === 'staff'` 拒绝 |
| 登录失败锁定 | 连续 5 次错误，锁定 30 分钟 |
| 首次登录改密 | `must_change_password` 字段，登录返回 `mustChangePassword: true` |
| 短 Token | 2h 有效期，无 refresh token，过期重新登录 |
| 防枚举 | 用户名不存在 / 密码错误返回同一错误码 |
| 超级管理员保护 | 不能修改/禁用/重置超级管理员 |

### 4.4 角色权限矩阵

| 操作 | super admin | admin | operator | viewer |
|------|:-----------:|:-----:|:--------:|:------:|
| 管理员 CRUD | Y | - | - | - |
| 商品 CRUD | Y | Y | Y | - |
| 上架/下架 | Y | Y | Y | - |
| 库存调整 | Y | Y | Y | - |
| 订单查看 | Y | Y | Y | Y |
| 发货/取消/退款 | Y | Y | Y | - |
| 用户封禁/解封 | Y | Y | - | - |
| 数据概览 | Y | Y | Y | Y |

> 当前实现：super admin 通过 `requireSuperAdmin` 中间件控制。
> 后续演进：role 级别的权限控制可通过 `requireRole('admin', 'operator')` 中间件实现，暂不需要。

---

## 5. 路由架构

### 5.1 Gateway 路由转发表

按最长前缀匹配，admin 路由分发到各域服务：

| 前缀 | 下游服务 | 说明 |
|------|---------|------|
| `/api/v1/admin/auth` | user-service | 管理员认证 |
| `/api/v1/admin/manage` | user-service | 管理员管理 |
| `/api/v1/admin/user` | user-service | 用户管理 |
| `/api/v1/admin/product` | product-service | 商品管理 |
| `/api/v1/admin/category` | product-service | 分类管理 |
| `/api/v1/admin/stock` | product-service | 库存管理 |
| `/api/v1/admin/order` | order-service | 订单管理 |
| `/api/v1/admin/dashboard` | order-service | 数据概览 |

### 5.2 各服务 Admin 路由挂载

```
user-service (:3001)
  /api/v1/admin/auth/*       -- adminAuthRoutes
  /api/v1/admin/manage/*     -- adminManageRoutes   (requireSuperAdmin)
  /api/v1/admin/user/*       -- adminUserRoutes     (Phase 4)

product-service (:3002)
  /api/v1/admin/product/*    -- adminProductRoutes  (adminAuthMiddleware)
  /api/v1/admin/category/*   -- adminCategoryRoutes (adminAuthMiddleware)
  /api/v1/admin/stock/*      -- adminStockRoutes    (adminAuthMiddleware)

order-service (:3004)
  /api/v1/admin/order/*      -- adminOrderRoutes    (adminAuthMiddleware)
  /api/v1/admin/dashboard/*  -- dashboardRoutes     (Phase 5)
```

---

## 6. 开发路线图

> 每个 Phase 独立可交付，建议一个 Phase 一次会话。

### Phase 0 -- 管理员体系基础 [已完成]

**目标：** 建立管理员独立身份体系，完成认证闭环和管理员 CRUD。

- [x] `admin_service.admins` 表 + 迁移
- [x] Admin JWT 签发/验证（`type: 'staff'`、`isSuper`）
- [x] `createAdminAuthMiddleware` + `requireSuperAdmin`
- [x] 管理员认证：login、change-password、profile
- [x] 管理员管理：create、list、update、toggle-status、reset-password
- [x] 所有现有 admin 路由切换到 `adminAuthMiddleware`
- [x] Seed 内置账号 admin/admin（首次登录强制改密）
- [x] `docs/api-admin.md` 接口文档

---

### Phase 1 -- 商品管理补全

**目标：** 管理员能完整管理商品生命周期（列表 -> 详情 -> 上下架 -> SKU -> 图片）。

| 接口 | 说明 |
|------|------|
| `POST /admin/product/list` | 管理端商品列表（含 draft/archived，支持筛选排序分页） |
| `POST /admin/product/detail` | 管理端商品详情（含全部 SKU、图片、分类） |
| `POST /admin/product/toggle-status` | 上架 / 下架 |
| `POST /admin/product/sku/delete` | 删除 SKU |
| `POST /admin/product/image/add` | 添加商品图片 |
| `POST /admin/product/image/delete` | 删除商品图片 |
| `POST /admin/product/image/sort` | 图片排序 |

改动范围：product-service（routes / services / repositories / schemas）

---

### Phase 2 -- 分类管理补全

**目标：** 管理员能完整管理分类树（含已禁用分类的查看和删除）。

| 接口 | 说明 |
|------|------|
| `POST /admin/category/list` | 管理端分类列表（含已禁用） |
| `POST /admin/category/tree` | 管理端分类树 |
| `POST /admin/category/delete` | 删除分类（有关联商品时拒绝） |

改动范围：product-service（routes / services / schemas）

---

### Phase 3 -- 订单管理补全

**目标：** 管理员能查看订单详情，执行取消和退款操作。

| 接口 | 说明 |
|------|------|
| `POST /admin/order/detail` | 订单详情（含用户信息、地址、商品、支付记录） |
| `POST /admin/order/cancel` | 管理员取消订单（自动释放库存） |
| `POST /admin/order/refund` | 退款处理 |

改动范围：order-service（routes / services / schemas），需调用 internal/stock/release

---

### Phase 4 -- 用户管理

**目标：** 管理员能查看和管理 C 端用户。

| 接口 | 说明 |
|------|------|
| `POST /admin/user/list` | 用户列表（分页、按邮箱/昵称搜索） |
| `POST /admin/user/detail` | 用户详情（含地址列表、订单统计） |
| `POST /admin/user/toggle-status` | 封禁 / 解封用户 |

改动范围：user-service（新建 admin-user routes / service / schema），gateway 添加路由

注意：用户详情中的"订单统计"需要跨服务调用 order-service 的 internal 接口。

---

### Phase 5 -- 数据概览

**目标：** 提供运营基础数据看板。

| 接口 | 说明 |
|------|------|
| `POST /admin/dashboard/overview` | 今日订单数、销售额、新增用户数、活跃用户数 |
| `POST /admin/dashboard/order-stats` | 订单趋势（按天/周/月，各状态分布） |
| `POST /admin/dashboard/sales-stats` | 销售额趋势（按天/周/月，TOP 商品） |

改动范围：order-service 或新建聚合层，需跨服务调用（order + user internal 接口）

---

## 7. 演进方向（不在当前范围）

| 方向 | 说明 | 触发条件 |
|------|------|---------|
| 细粒度 RBAC | `permissions` 表 + 资源级权限控制 | 角色不够用（>5 种角色或需要按资源授权） |
| 操作审计日志 | `admin_audit_logs` 表，记录谁在何时做了什么 | 合规要求或需要追溯操作 |
| MFA 二次验证 | TOTP / 短信验证码 | 安全合规要求 |
| Admin 独立部署 | 各服务的 admin 路由拆到独立进程 | 后台流量与 C 端需要独立扩缩容 |
| IP 白名单 | Caddy/中间件层限制后台接口的来源 IP | 生产安全加固 |
