import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { CreateUserInput } from './user.schema';

export const UserService = {
  // 查：获取所有
  async findAll() {
    return await db.select().from(users);
  },

  // 查：单个
  async findById(id: number) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },

  // 增
  async create(data: CreateUserInput) {
    const [newUser] = await db.insert(users).values(data).returning();
    return newUser;
  },

  // 改
  async update(id: number, data: Partial<CreateUserInput>) {
    const [updatedUser] = await db.update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  },

  // 删
  async delete(id: number) {
    const [deletedUser] = await db.delete(users)
      .where(eq(users.id, id))
      .returning();
    return deletedUser;
  }
};