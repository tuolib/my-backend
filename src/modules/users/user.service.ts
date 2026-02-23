import { db } from '@/db';
import { users } from '@/db/schema.ts';
import { eq } from 'drizzle-orm';
import type { CreateUserInput } from './user.schema.ts';
import * as bcrypt from 'bcrypt';

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
    // 1. 哈希密码
    const saltRounds = 10; // 推荐的加盐轮数
    const passwordHash = await bcrypt.hash(data.password, saltRounds);

    // 2. 准备插入数据库的数据 (userData 中已不包含 username)
    const { password, confirmPassword, ...userData } = data;
    const newUserPayload = {
      ...userData,
      passwordHash,
    };

    // 3. 插入数据库，并只返回安全字段 (移除 username)
    const [newUser] = await db
      .insert(users)
      .values(newUserPayload)
      .returning({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
      });
    return newUser;
  },

  // 改
  async update(id: number, data: Partial<CreateUserInput>) {
    const [updatedUser] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updatedUser;
  },

  // 删
  async delete(id: number) {
    const [deletedUser] = await db.delete(users).where(eq(users.id, id)).returning();
    return deletedUser;
  },
};
