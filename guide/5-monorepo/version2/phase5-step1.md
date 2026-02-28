# Phase 5 — Step 1: services/product-service 商品/分类/SKU/搜索

## 前置条件
Phase 4 已完成。请先确认：
- user-service 全部测试通过
- 种子数据中已有分类、商品、SKU 数据
- Docker 中 PostgreSQL 和 Redis 运行中

## 本次任务
实现 product-service 的公开路由（商品列表/详情/搜索、分类）、Admin 路由（商品/分类/SKU CRUD）、缓存策略。
库存内部接口留给下一步。

## 执行步骤

### 第一步：读取架构规范
请先阅读：
- `CLAUDE.md`（Service 分层结构 + 响应格式）
- `docs/architecture.md` 第 2.2 节（Product Service 边界）+ 第 3.4 节（表结构）+ 第 7.3 节（product/* + category/* + admin/product/* 路由）+ 第 11 章（搜索与缓存）+ 第 4 章（Redis Key 规范）

### 第二步：审计现有代码
扫描 `services/product-service/src/`，列出现状。

### 第三步：安装依赖
```bash
cd services/product-service
bun add hono @repo/shared @repo/database zod
bun add -d typescript @types/bun
```

### 第四步：搭建目录结构

```
services/product-service/src/
├── index.ts
├── routes/
│   ├── product.ts            # /api/v1/product/* 公开路由
│   ├── category.ts           # /api/v1/category/* 公开路由
│   ├── admin-product.ts      # /api/v1/admin/product/* 管理路由
│   ├── admin-category.ts     # /api/v1/admin/category/* 管理路由
│   └── internal.ts           # /internal/* 内部路由（Step 2 完善）
├── services/
│   ├── product.service.ts
│   ├── category.service.ts
│   ├── sku.service.ts
│   ├── search.service.ts
│   └── cache.service.ts      # 缓存策略封装
├── repositories/
│   ├── product.repo.ts
│   ├── category.repo.ts
│   ├── sku.repo.ts
│   └── image.repo.ts
├── schemas/
│   ├── product.schema.ts
│   ├── category.schema.ts
│   └── sku.schema.ts
└── types/
    └── index.ts
```

### 第五步：实现 Repository 层

**5a. `repositories/product.repo.ts`**
```typescript
findById(id: string): Promise<Product | null>
findBySlug(slug: string): Promise<Product | null>
findList(params: {
  page: number; pageSize: number; sort: string; order: SortOrder;
  filters?: { status?: string; categoryId?: string; brand?: string }
}): Promise<{ items: Product[]; total: number }>
  // 支持：状态筛选、分类筛选（通过 product_categories JOIN）、品牌筛选
  // 分页 + 排序（createdAt / price / sales）

search(params: {
  keyword: string; categoryId?: string; priceMin?: number; priceMax?: number;
  sort: string; page: number; pageSize: number;
}): Promise<{ items: Product[]; total: number }>
  // PostgreSQL 全文搜索：
  //   WHERE to_tsvector('simple', title || ' ' || coalesce(description,'') || ' ' || coalesce(brand,''))
  //         @@ plainto_tsquery('simple', :keyword)
  //   ORDER BY ts_rank(...) DESC（当 sort=relevance 时）
  // 价格区间：JOIN skus → WHERE skus.price BETWEEN :min AND :max（或用 products.min_price）
  // 分类筛选：JOIN product_categories

create(data: NewProduct): Promise<Product>
updateById(id: string, data: Partial<Product>): Promise<Product | null>
softDelete(id: string): Promise<void>    // 设 deleted_at + status=archived
updatePriceRange(productId: string): Promise<void>
  // 查该商品所有 active SKU 的 min/max price，更新 products.min_price/max_price
updateSalesCount(productId: string, increment: number): Promise<void>
  // UPDATE products SET total_sales = total_sales + :increment
```

**5b. `repositories/category.repo.ts`**
```typescript
findById(id: string): Promise<Category | null>
findBySlug(slug: string): Promise<Category | null>
findAll(): Promise<Category[]>                // 查全部，service 层组装树
findByParentId(parentId: string | null): Promise<Category[]>
create(data: NewCategory): Promise<Category>
updateById(id: string, data: Partial<Category>): Promise<Category | null>
```

**5c. `repositories/sku.repo.ts`**
```typescript
findById(id: string): Promise<Sku | null>
findByProductId(productId: string): Promise<Sku[]>
findByIds(ids: string[]): Promise<Sku[]>     // 批量查询（购物车/订单用）
findBySkuCode(code: string): Promise<Sku | null>
create(data: NewSku): Promise<Sku>
updateById(id: string, data: Partial<Sku>): Promise<Sku | null>
```

**5d. `repositories/image.repo.ts`**
```typescript
findByProductId(productId: string): Promise<ProductImage[]>
createMany(images: NewProductImage[]): Promise<ProductImage[]>
deleteByProductId(productId: string): Promise<void>
```

### 第六步：实现缓存 Service

**`services/cache.service.ts`**
```typescript
import { redis } from "@repo/database";

// ── 商品详情缓存（Cache-Aside + 穿透防护 + 击穿防护）──

async function getCachedProductDetail(productId: string): Promise<ProductDetail | null>
  // 1. GET product:detail:{productId}
  // 2. 命中 → 检查是否空值标记 {"empty":true} → 是则返回 null
  // 3. 命中 → 解析 JSON 返回，打日志 [CACHE HIT]
  // 4. 未命中 → 返回 null，打日志 [CACHE MISS]

async function setCachedProductDetail(productId: string, data: ProductDetail | null): Promise<void>
  // data = null：写入 {"empty":true}，TTL = 60s（穿透防护）
  // data 存在：写入 JSON，TTL = 10min + random(0, 2min)（抖动防雪崩）

async function invalidateProductDetail(productId: string): Promise<void>
  // DEL product:detail:{productId}

// ── 分类树缓存（定时预热）──

async function getCachedCategoryTree(): Promise<CategoryNode[] | null>
  // GET product:category:tree

async function setCachedCategoryTree(tree: CategoryNode[]): Promise<void>
  // SET product:category:tree JSON EX 3600 (60min)

async function invalidateCategoryTree(): Promise<void>

// ── 搜索结果缓存 ──

async function getCachedSearch(queryHash: string): Promise<SearchResult | null>
  // GET product:search:{queryHash}

async function setCachedSearch(queryHash: string, data: SearchResult): Promise<void>
  // SET product:search:{queryHash} JSON EX 180 (3min)

// ── 工具 ──
function hashQuery(params: object): string
  // JSON.stringify → sha256 → 取前 16 位作为 queryHash
```

### 第七步：实现 Service 层

**7a. `services/product.service.ts`**
```typescript
getDetail(productId: string): Promise<ProductDetail>
  // 1. 查缓存 → 命中直接返回
  // 2. 缓存未命中 → 查 DB（product + skus + images + categories）
  // 3. DB 无结果 → 缓存空值 + 抛 NotFoundError(PRODUCT_NOT_FOUND)
  // 4. DB 有结果 → 组装 ProductDetail → 写缓存 → 返回

getList(params: ListInput): Promise<PaginatedData<ProductListItem>>
  // 直接查 DB（列表不缓存，或使用短缓存）
  // 返回：商品基本信息 + 首图 + 价格区间

// Admin 操作
create(input: CreateProductInput): Promise<Product>
  // 创建商品 + 图片 + 分类关联
  // 清除分类树缓存（分类下商品数可能变）

update(productId: string, input: UpdateProductInput): Promise<Product>
  // 更新商品 + 可选更新图片/分类关联
  // 清除该商品详情缓存

delete(productId: string): Promise<void>
  // 软删除 + 清除缓存
```

**7b. `services/category.service.ts`**
```typescript
getTree(): Promise<CategoryNode[]>
  // 1. 查缓存 → 命中直接返回
  // 2. 未命中 → 查全部 categories → 递归组装树 → 写缓存 → 返回
  // CategoryNode = { id, name, slug, children: CategoryNode[] }

getDetail(categoryId: string): Promise<Category>

// Admin
create(input: CreateCategoryInput): Promise<Category>
  // 创建 + 清除分类树缓存

update(categoryId: string, input: UpdateCategoryInput): Promise<Category>
  // 更新 + 清除缓存
```

**7c. `services/sku.service.ts`**
```typescript
listByProduct(productId: string): Promise<Sku[]>

// Admin
create(input: CreateSkuInput): Promise<Sku>
  // 1. 检查 sku_code 唯一性 → 重复抛 ConflictError(DUPLICATE_SKU_CODE)
  // 2. 创建 SKU
  // 3. Redis SET stock:{skuId} {input.stock}（初始化库存）
  // 4. 更新 product 的 min_price/max_price
  // 5. 清除商品详情缓存

update(skuId: string, input: UpdateSkuInput): Promise<Sku>
  // 更新 SKU（不允许直接改 stock，stock 通过库存接口管理）
  // 如果价格变了 → 更新 product 的 min_price/max_price
  // 清除商品详情缓存
```

**7d. `services/search.service.ts`**
```typescript
search(params: SearchInput): Promise<PaginatedData<ProductListItem>>
  // 1. hashQuery(params) 生成 queryHash
  // 2. 查缓存 → 命中返回
  // 3. 未命中 → productRepo.search(params)
  // 4. 写缓存（TTL 3min）
  // 5. 返回
```

### 第八步：实现 Zod Schema

**`schemas/product.schema.ts`**
```typescript
productListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "price", "sales"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  filters: z.object({
    status: z.enum(["active", "draft", "archived"]).optional(),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
  }).optional(),
});

productDetailSchema = z.object({ id: z.string().min(1) });

productSearchSchema = z.object({
  keyword: z.string().min(1).max(200),
  categoryId: z.string().optional(),
  priceMin: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "sales", "newest"]).default("relevance"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

// Admin schemas
createProductSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200).optional(),    // 不传则自动生成
  description: z.string().optional(),
  brand: z.string().max(100).optional(),
  status: z.enum(["draft", "active"]).default("draft"),
  attributes: z.record(z.unknown()).optional(),
  categoryIds: z.array(z.string()).min(1),
  images: z.array(z.object({
    url: z.string().url(),
    altText: z.string().max(200).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })).optional(),
});

updateProductSchema = z.object({
  id: z.string().min(1),
  // ...createProductSchema 所有字段改 optional
});

deleteProductSchema = z.object({ id: z.string().min(1) });
```

**`schemas/sku.schema.ts`**
```typescript
skuListSchema = z.object({ productId: z.string().min(1) });

createSkuSchema = z.object({
  productId: z.string().min(1),
  skuCode: z.string().min(1).max(50),
  price: z.number().positive(),
  comparePrice: z.number().positive().optional(),
  costPrice: z.number().positive().optional(),
  stock: z.number().int().min(0).default(0),
  lowStock: z.number().int().min(0).default(5),
  weight: z.number().min(0).optional(),
  attributes: z.record(z.string()),     // {"color":"红","size":"XL"}
  barcode: z.string().max(50).optional(),
});

updateSkuSchema = z.object({
  skuId: z.string().min(1),
  // price, comparePrice, costPrice, lowStock, weight, attributes, barcode, status
  // 注意：不包含 stock（库存通过专用接口管理）
});
```

### 第九步：实现路由层

**`routes/product.ts`** — 公开路由
```typescript
// POST /api/v1/product/list
// POST /api/v1/product/detail
// POST /api/v1/product/search
// POST /api/v1/product/sku/list
```

**`routes/category.ts`** — 公开路由
```typescript
// POST /api/v1/category/list
// POST /api/v1/category/detail
// POST /api/v1/category/tree
```

**`routes/admin-product.ts`** — 管理路由（挂 authMiddleware，未来加 admin 角色检查）
```typescript
// POST /api/v1/admin/product/create
// POST /api/v1/admin/product/update
// POST /api/v1/admin/product/delete
// POST /api/v1/admin/product/sku/create
// POST /api/v1/admin/product/sku/update
```

**`routes/admin-category.ts`** — 管理路由
```typescript
// POST /api/v1/admin/category/create
// POST /api/v1/admin/category/update
```

**`routes/internal.ts`** — 内部路由（本步只实现 sku/batch，库存接口留 Step 2）
```typescript
// POST /internal/product/sku/batch — 批量查询 SKU 详情
//   Body: { skuIds: string[] }
//   返回：SKU 列表（含 product 基本信息 + 首图）
```

### 第十步：组装 App 入口

**`src/index.ts`**
```typescript
// 全局中间件：requestId → logger → onError(errorHandler)
// 挂载路由：
//   /api/v1/product → productRoutes
//   /api/v1/category → categoryRoutes
//   /api/v1/admin/product → adminProductRoutes
//   /api/v1/admin/category → adminCategoryRoutes
//   /internal/product → internalRoutes
// 健康检查：POST /health
// 端口：:3002
```

### 第十一步：编写集成测试

**`src/__tests__/product.test.ts`**
```
1. 商品列表 → 返回种子数据 + 分页信息
2. 商品列表（按价格排序）→ 排序正确
3. 商品列表（分类筛选）→ 只返回该分类下的商品
4. 商品详情 → 返回商品 + SKU + 图片 + 分类
5. 商品详情（不存在）→ 404 PRODUCT_NOT_FOUND
6. 商品详情（第二次请求）→ 缓存命中日志可见
```

**`src/__tests__/search.test.ts`**
```
1. 搜索 "iPhone" → 返回包含 iPhone 的商品
2. 搜索 "不存在的商品" → 返回空列表（不报错）
3. 搜索 + 价格区间筛选 → 正确过滤
4. 搜索 + 分类筛选 → 正确过滤
```

**`src/__tests__/category.test.ts`**
```
1. 分类列表 → 返回全部
2. 分类树 → 嵌套结构正确（顶级 → 子分类）
3. 分类详情 → 正确
```

**`src/__tests__/admin.test.ts`**
```
前置：使用种子数据的 admin 用户 token（或跳过 auth 直接测试）

1. 创建商品 → 成功 + 自动生成 slug
2. 创建 SKU → 成功 + Redis 库存初始化 + product.min_price 更新
3. 更新商品 → 成功 + 缓存失效
4. 更新 SKU 价格 → product.min_price/max_price 更新
5. 删除商品 → 软删除 + 缓存清除
6. 创建分类 → 成功 + 分类树缓存失效
7. SKU code 重复 → 409 DUPLICATE_SKU_CODE
```

**`src/__tests__/internal.test.ts`**
```
1. /internal/product/sku/batch → 批量返回 SKU + 商品信息 + 首图
2. 部分 skuId 不存在 → 只返回存在的
3. 空数组 → 返回空
```

### 第十二步：验证
```bash
docker compose up -d

cd services/product-service
bun test

# 手动测试
bun run src/index.ts &
sleep 1

curl -s -X POST http://localhost:3002/api/v1/product/list \
  -H "Content-Type: application/json" \
  -d '{"page":1,"pageSize":5}' | jq .

curl -s -X POST http://localhost:3002/api/v1/product/search \
  -H "Content-Type: application/json" \
  -d '{"keyword":"iPhone"}' | jq .

curl -s -X POST http://localhost:3002/api/v1/category/tree \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

kill %1
```

### 第十三步：输出报告
- 文件清单 + 目录树
- 全部测试结果
- 缓存命中日志示例
- 下一步预告（Phase 5 Step 2）：库存内部接口（reserve/release/confirm/sync）+ 并发测试

## 重要约束
- 全文搜索使用 `'simple'` 配置（兼容中英文基础分词），不依赖额外插件
- 缓存 TTL 加随机抖动：`baseTTL + Math.floor(Math.random() * baseTTL * 0.2)`
- 缓存穿透防护：DB 查无结果时缓存 `{"empty":true}` TTL 60s
- Admin 路由挂 authMiddleware，当前阶段不做 admin 角色检查（预留）
- SKU 创建时自动初始化 Redis 库存（SET stock:{skuId} {stock}）
- 不允许通过 SKU update 直接修改 stock 字段，stock 仅通过库存专用接口管理
- 商品列表查询的价格用 products.min_price/max_price 冗余字段，避免每次 JOIN skus
- slug 如果不传则从 title 自动生成（转小写 + 空格替换为 - + 去除特殊字符 + 追加短 ID 保证唯一）
