/**
 * Schema 统一导出
 * 三个域：user_service, product_service, order_service
 */

// ── User Service 域 ──
export {
  userServiceSchema,
  users,
  userAddresses,
  refreshTokens,
  usersRelations,
  userAddressesRelations,
  refreshTokensRelations,
} from './users';
export type {
  User, NewUser,
  UserAddress, NewUserAddress,
  RefreshToken, NewRefreshToken,
} from './users';

// ── Product Service 域 ──
export {
  productServiceSchema,
  categories,
  products,
  productCategories,
  productImages,
  skus,
  banners,
  dataMigrations,
  categoriesRelations,
  productsRelations,
  productCategoriesRelations,
  productImagesRelations,
  skusRelations,
} from './products';
export type {
  Category, NewCategory,
  Product, NewProduct,
  ProductImage, NewProductImage,
  Sku, NewSku,
  Banner, NewBanner,
  DataMigration,
} from './products';

// ── Order Service 域 ──
export {
  orderServiceSchema,
  orders,
  orderItems,
  orderAddresses,
  paymentRecords,
  stockOperations,
  ordersRelations,
  orderItemsRelations,
  orderAddressesRelations,
  paymentRecordsRelations,
} from './orders';
export type {
  Order, NewOrder,
  OrderItem, NewOrderItem,
  OrderAddress, NewOrderAddress,
  PaymentRecord, NewPaymentRecord,
  StockOperation, NewStockOperation,
} from './orders';
