import { eq, and, isNull } from 'drizzle-orm';
import { users } from '../schema/users';
import { SoftDeleteRepository } from './base.repository';

type UserInsert = typeof users.$inferInsert;
type UserSelect = typeof users.$inferSelect;

export class UserRepository extends SoftDeleteRepository<typeof users, UserInsert, UserSelect> {
  constructor() {
    super(users, 'users');
  }

  async findByEmail(email: string): Promise<UserSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPhone(phone: string): Promise<UserSelect | null> {
    const rows = await this.db
      .select()
      .from(this.table)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }
}
