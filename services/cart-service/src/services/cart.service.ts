/**
 * Cart Service — 购物车核心业务逻辑
 * 数据全部存 Redis Hash，不操作 PostgreSQL
 * Key: cart:{userId}  Field: {skuId}  Value: JSON CartItem
 */
import {
  ValidationError,
  NotFoundError,
  ErrorCode,
} from '@repo/shared';
import { redis } from '@repo/database';
import * as productClient from './product-client';
import type {
  CartItem,
  CartListItem,
  AddCartInput,
  UpdateCartInput,
  CheckoutPreview,
  CheckoutPreviewItem,
  PriceChangedItem,
  InsufficientItem,
  UnavailableItem,
} from '../types';

const CART_MAX_ITEMS = 50;
const CART_TTL = 2592000; // 30 天（秒）

function cartKey(userId: string): string {
  return `cart:${userId}`;
}

// ── 添加商品到购物车 ──

export async function add(userId: string, input: AddCartInput): Promise<void> {
  const key = cartKey(userId);

  // 检查是否已在购物车中
  const existing = await redis.hget(key, input.skuId);

  // 如果是新 SKU，检查购物车上限
  if (!existing) {
    const count = await redis.hlen(key);
    if (count >= CART_MAX_ITEMS) {
      throw new ValidationError(
        '购物车商品数量已达上限（50 种）',
        ErrorCode.CART_LIMIT_EXCEEDED,
      );
    }
  }

  // 查询 SKU 实时信息
  const skuList = await productClient.fetchSkuBatch([input.skuId]);
  const sku = skuList[0];

  if (!sku || sku.status !== 'active') {
    throw new ValidationError(
      '所选商品已下架或不存在',
      ErrorCode.CART_SKU_UNAVAILABLE,
    );
  }

  // 提示性库存检查
  const totalQty = existing
    ? (JSON.parse(existing) as CartItem).quantity + input.quantity
    : input.quantity;

  if (sku.stock < totalQty) {
    throw new ValidationError(
      `库存不足，当前库存 ${sku.stock}`,
      ErrorCode.STOCK_INSUFFICIENT,
      { available: sku.stock, requested: totalQty },
    );
  }

  // 构建/更新购物车项
  let item: CartItem;

  if (existing) {
    item = JSON.parse(existing) as CartItem;
    item.quantity += input.quantity;
    // 刷新快照为最新价格
    item.snapshot = {
      productId: sku.productId,
      productTitle: sku.productTitle,
      skuAttrs: sku.attributes,
      price: sku.price,
      imageUrl: sku.primaryImage,
    };
  } else {
    item = {
      skuId: input.skuId,
      quantity: input.quantity,
      selected: true,
      addedAt: new Date().toISOString(),
      snapshot: {
        productId: sku.productId,
        productTitle: sku.productTitle,
        skuAttrs: sku.attributes,
        price: sku.price,
        imageUrl: sku.primaryImage,
      },
    };
  }

  await redis.hset(key, input.skuId, JSON.stringify(item));
  await redis.expire(key, CART_TTL);
}

// ── 获取购物车列表 ──

export async function list(userId: string): Promise<CartListItem[]> {
  const key = cartKey(userId);
  const all = await redis.hgetall(key);

  if (!all || Object.keys(all).length === 0) {
    return [];
  }

  // 解析购物车项
  const items: CartItem[] = Object.entries(all).map(([skuId, val]) => {
    const parsed = JSON.parse(val) as CartItem;
    parsed.skuId = skuId;
    return parsed;
  });

  // 批量查询实时 SKU 数据
  const skuIds = items.map((i) => i.skuId);
  const skuList = await productClient.fetchSkuBatch(skuIds);
  const skuMap = new Map(skuList.map((s) => [s.id, s]));

  // 构建列表项
  const result: CartListItem[] = items.map((item) => {
    const sku = skuMap.get(item.skuId);
    return {
      ...item,
      currentPrice: sku?.price ?? item.snapshot.price,
      currentStock: sku?.stock ?? 0,
      priceChanged: sku ? sku.price !== item.snapshot.price : false,
      unavailable: !sku || sku.status !== 'active',
      stockInsufficient: sku ? sku.stock < item.quantity : true,
    };
  });

  // 按 addedAt 倒序
  result.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());

  return result;
}

// ── 更新商品数量 ──

export async function update(userId: string, input: UpdateCartInput): Promise<void> {
  const key = cartKey(userId);
  const existing = await redis.hget(key, input.skuId);

  if (!existing) {
    throw new NotFoundError(
      '购物车中无此商品',
      ErrorCode.CART_ITEM_NOT_FOUND,
    );
  }

  // quantity = 0 等同于删除
  if (input.quantity <= 0) {
    await redis.hdel(key, input.skuId);
    return;
  }

  // 提示性库存检查
  const stock = await productClient.fetchSkuStock(input.skuId);
  if (stock < input.quantity) {
    throw new ValidationError(
      `库存不足，当前库存 ${stock}`,
      ErrorCode.STOCK_INSUFFICIENT,
      { available: stock, requested: input.quantity },
    );
  }

  const item = JSON.parse(existing) as CartItem;
  item.quantity = input.quantity;

  await redis.hset(key, input.skuId, JSON.stringify(item));
  await redis.expire(key, CART_TTL);
}

// ── 删除商品 ──

export async function remove(userId: string, skuIds: string[]): Promise<void> {
  if (skuIds.length === 0) return;
  const key = cartKey(userId);
  await redis.hdel(key, ...skuIds);
}

// ── 清空购物车 ──

export async function clear(userId: string): Promise<void> {
  await redis.del(cartKey(userId));
}

// ── 选择/取消选择 ──

export async function select(
  userId: string,
  skuIds: string[],
  selected: boolean,
): Promise<void> {
  const key = cartKey(userId);

  for (const skuId of skuIds) {
    const raw = await redis.hget(key, skuId);
    if (!raw) continue; // 不存在的静默跳过

    const item = JSON.parse(raw) as CartItem;
    item.selected = selected;
    await redis.hset(key, skuId, JSON.stringify(item));
  }

  await redis.expire(key, CART_TTL);
}

// ── 结算预览 ──

export async function checkoutPreview(userId: string): Promise<CheckoutPreview> {
  const key = cartKey(userId);
  const all = await redis.hgetall(key);

  if (!all || Object.keys(all).length === 0) {
    throw new ValidationError('购物车为空', ErrorCode.CART_ITEM_NOT_FOUND);
  }

  // 解析购物车项
  const allItems: CartItem[] = Object.entries(all).map(([skuId, val]) => {
    const parsed = JSON.parse(val) as CartItem;
    parsed.skuId = skuId;
    return parsed;
  });

  // 过滤已勾选
  const selectedItems = allItems.filter((i) => i.selected);
  if (selectedItems.length === 0) {
    throw new ValidationError('请选择至少一件商品', ErrorCode.CART_ITEM_NOT_FOUND);
  }

  // 批量查实时数据
  const skuIds = selectedItems.map((i) => i.skuId);
  const skuList = await productClient.fetchSkuBatch(skuIds);
  const skuMap = new Map(skuList.map((s) => [s.id, s]));

  const items: CheckoutPreviewItem[] = [];
  const unavailableItems: UnavailableItem[] = [];
  const priceChangedItems: PriceChangedItem[] = [];
  const insufficientItems: InsufficientItem[] = [];

  let itemsTotal = 0;

  for (const cartItem of selectedItems) {
    const sku = skuMap.get(cartItem.skuId);

    // SKU 不存在或已下架
    if (!sku || sku.status !== 'active') {
      unavailableItems.push({
        skuId: cartItem.skuId,
        productTitle: cartItem.snapshot.productTitle,
      });
      continue;
    }

    // 价格变动检查
    if (sku.price !== cartItem.snapshot.price) {
      priceChangedItems.push({
        skuId: cartItem.skuId,
        productTitle: sku.productTitle,
        oldPrice: cartItem.snapshot.price,
        newPrice: sku.price,
      });
    }

    // 库存不足检查
    if (sku.stock < cartItem.quantity) {
      insufficientItems.push({
        skuId: cartItem.skuId,
        productTitle: sku.productTitle,
        requested: cartItem.quantity,
        available: sku.stock,
      });
    }

    // 用实时价格计算金额
    const priceNum = parseFloat(sku.price);
    itemsTotal += priceNum * cartItem.quantity;

    items.push({
      skuId: cartItem.skuId,
      quantity: cartItem.quantity,
      currentPrice: sku.price,
      currentStock: sku.stock,
      productId: sku.productId,
      productTitle: sku.productTitle,
      skuAttrs: sku.attributes,
      imageUrl: sku.primaryImage,
    });
  }

  const shippingFee = 0;
  const discountAmount = 0;
  const payAmount = itemsTotal + shippingFee - discountAmount;

  return {
    items,
    summary: {
      itemsTotal: itemsTotal.toFixed(2),
      shippingFee: shippingFee.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      payAmount: payAmount.toFixed(2),
    },
    warnings: {
      unavailableItems,
      priceChangedItems,
      insufficientItems,
    },
    canCheckout: unavailableItems.length === 0 && insufficientItems.length === 0,
  };
}

// ── 内部接口：清理已下单的 SKU ──

export async function clearItems(userId: string, skuIds: string[]): Promise<void> {
  if (skuIds.length === 0) return;
  const key = cartKey(userId);
  // 幂等：cart 不存在或 skuId 不在 cart 中都静默成功
  await redis.hdel(key, ...skuIds);
}
