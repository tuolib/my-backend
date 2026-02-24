import { dbRead, dbWrite } from '@/db';
import { users } from '@/db/schema.ts';
import { eq } from 'drizzle-orm';

export type NewUserPayload = { email: string; passwordHash: string };
export type UpdateUserPayload = Partial<{
  email: string;
  passwordHash: string;
  isActive: boolean;
}>;

export const UserRepository = {
  async findAll() {
    return await dbRead.select().from(users);
  },

  async findById(id: number) {
    const [user] = await dbRead.select().from(users).where(eq(users.id, id));
    return user;
  },

  async findByEmail(email: string) {
    const [user] = await dbRead.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  },

  async create(payload: NewUserPayload) {
    const [newUser] = await dbWrite
      .insert(users)
      .values(payload)
      .returning({
        id: users.id,
        email: users.email,
        createdAt: users.createdAt,
      });
    return newUser;
  },

  async update(id: number, payload: UpdateUserPayload) {
    const [updatedUser] = await dbWrite
      .update(users)
      .set(payload)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  },

  async delete(id: number) {
    const [deletedUser] = await dbWrite.delete(users).where(eq(users.id, id)).returning();
    return deletedUser;
  },

  async updateLastLoginAt(id: number) {
    await dbWrite.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
  },
};
