import { OrderRepository } from './order.repository.ts';
import { RestaurantRepository } from '@/modules/menu/menu.repository.ts';
import { reserveStock, rollbackReserveStock } from './inventory.service.ts';
import { logger } from '@/lib/logger.ts';
import type { CreateOrderInput } from './order.schema.ts';

export class OrderError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

export const OrderService = {
  async create(userId: number, data: CreateOrderInput) {
    // 1. 验证饭店存在且营业
    const restaurant = await RestaurantRepository.findById(data.restaurantId);
    if (!restaurant || !restaurant.isActive) {
      throw new OrderError('饭店不存在或已停业', 404);
    }

    // 2. 批量查询菜品，过滤下架商品
    const menuItemIds = data.items.map((i) => i.menuItemId);
    const menuItemRows = await OrderRepository.getMenuItemsByIds(menuItemIds);
    const menuMap = new Map(menuItemRows.map((m) => [m.id, m]));

    const unavailable = data.items.filter((i) => {
      const m = menuMap.get(i.menuItemId);
      return !m || !m.isAvailable;
    });
    if (unavailable.length > 0) {
      const ids = unavailable.map((i) => i.menuItemId).join(', ');
      throw new OrderError(`以下菜品不可用或不存在：${ids}`, 400);
    }

    // 3. 计算金额（价格快照：使用当前 DB 价格，防止客户端篡改）
    const itemPayloads = data.items.map((i) => {
      const m = menuMap.get(i.menuItemId)!;
      const unitPrice = parseFloat(m.price);
      const subtotal = +(unitPrice * i.quantity).toFixed(2);
      return {
        menuItemId: i.menuItemId,
        name: m.name,
        unitPrice: unitPrice.toFixed(2),
        quantity: i.quantity,
        subtotal: subtotal.toFixed(2),
      };
    });

    const totalAmount = itemPayloads
      .reduce((sum, i) => sum + parseFloat(i.subtotal), 0)
      .toFixed(2);

    // 4. 库存预扣（如果请求中带有 skuItems）
    //    skuItems 用于 SKU 级别的库存预扣（电商场景）
    //    普通菜单下单可不传 skuItems，跳过库存预扣
    const reservedSkus: Array<{ skuId: number; qty: number; idempotencyKey: string }> = [];
    if (data.skuItems && data.skuItems.length > 0) {
      for (const skuItem of data.skuItems) {
        const key = `reserve:${userId}:${skuItem.skuId}:${Date.now()}`;
        const result = await reserveStock(skuItem.skuId, skuItem.quantity, 0, key);
        if (!result.ok) {
          // 回补已预扣的 SKU
          for (const reserved of reservedSkus) {
            await rollbackReserveStock(reserved.skuId, reserved.qty, 0, reserved.idempotencyKey);
          }
          throw new OrderError(`SKU ${skuItem.skuId} 库存不足`, 400);
        }
        reservedSkus.push({ skuId: skuItem.skuId, qty: skuItem.quantity, idempotencyKey: key });
      }
    }

    // 5. 事务写入
    let order;
    try {
      order = await OrderRepository.create({
        userId,
        restaurantId: data.restaurantId,
        totalAmount,
        remark: data.remark,
        items: itemPayloads,
      });
    } catch (err) {
      // DB 写入失败 — 回补所有已预扣库存
      for (const reserved of reservedSkus) {
        await rollbackReserveStock(reserved.skuId, reserved.qty, 0, reserved.idempotencyKey);
      }
      throw err;
    }

    logger.info('order created with stock reservation', {
      orderId: order.id,
      reservedSkus: reservedSkus.length,
    });

    return order;
  },

  async pay(userId: number, orderId: number) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new OrderError('订单不存在', 404);
    if (order.userId !== userId) throw new OrderError('无权操作此订单', 403);
    if (order.status !== 'pending') {
      throw new OrderError(`订单状态为 ${order.status}，无法付款`, 400);
    }
    return OrderRepository.updateStatus(orderId, 'paid');
  },

  async cancel(userId: number, orderId: number, skuItems?: Array<{ skuId: number; quantity: number; idempotencyKey: string }>) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new OrderError('订单不存在', 404);
    if (order.userId !== userId) throw new OrderError('无权操作此订单', 403);
    if (order.status !== 'pending') {
      throw new OrderError(`只有待付款订单可以取消，当前状态：${order.status}`, 400);
    }

    const result = await OrderRepository.updateStatus(orderId, 'cancelled');

    // 回补库存（如果有 skuItems）
    if (skuItems && skuItems.length > 0) {
      for (const item of skuItems) {
        await rollbackReserveStock(item.skuId, item.quantity, orderId, item.idempotencyKey);
      }
      logger.info('order cancelled with stock rollback', { orderId, skuCount: skuItems.length });
    }

    return result;
  },

  async list(userId: number, page: number, pageSize: number, status?: string) {
    return OrderRepository.findByUser(userId, page, pageSize, status);
  },

  async detail(userId: number, orderId: number) {
    const order = await OrderRepository.findDetailById(orderId);
    if (!order) throw new OrderError('订单不存在', 404);
    if (order.userId !== userId) throw new OrderError('无权查看此订单', 403);
    return order;
  },
};
