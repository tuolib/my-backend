import { dbRead, dbWrite } from '@/db';
import { orders, orderItems, menuItems } from '@/db/schema.ts';
import { eq, sql, and } from 'drizzle-orm';

export type CreateOrderPayload = {
  userId: number;
  restaurantId: number;
  totalAmount: string;
  remark?: string;
  items: Array<{
    menuItemId: number;
    name: string;
    unitPrice: string;
    quantity: number;
    subtotal: string;
  }>;
};

export const OrderRepository = {
  async create(payload: CreateOrderPayload) {
    return dbWrite.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          userId: payload.userId,
          restaurantId: payload.restaurantId,
          totalAmount: payload.totalAmount,
          remark: payload.remark,
          status: 'pending',
        })
        .returning();

      await tx.insert(orderItems).values(
        payload.items.map((i) => ({
          orderId: order!.id,
          menuItemId: i.menuItemId,
          name: i.name,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          subtotal: i.subtotal,
        }))
      );

      return order!;
    });
  },

  async findById(id: number) {
    const [order] = await dbRead.select().from(orders).where(eq(orders.id, id));
    return order;
  },

  async findDetailById(id: number) {
    const [order] = await dbRead.select().from(orders).where(eq(orders.id, id));
    if (!order) return null;

    const items = await dbRead
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    return { ...order, items };
  },

  async findByUser(
    userId: number,
    page: number,
    pageSize: number,
    status?: string
  ) {
    const offset = (page - 1) * pageSize;
    const condition = status
      ? and(eq(orders.userId, userId), eq(orders.status, status))
      : eq(orders.userId, userId);

    const [rows, countResult] = await Promise.all([
      dbRead.select().from(orders).where(condition).limit(pageSize).offset(offset),
      dbRead.select({ count: sql<number>`count(*)::int` }).from(orders).where(condition),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },

  async updateStatus(id: number, status: string) {
    const [updated] = await dbWrite
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return updated;
  },

  async getMenuItemsByIds(ids: number[]) {
    if (ids.length === 0) return [];
    return dbRead.select().from(menuItems).where(sql`${menuItems.id} = ANY(${ids})`);
  },
};
