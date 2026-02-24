import * as bcrypt from 'bcrypt';
import { UserRepository } from './user.repository.ts';
import type { CreateUserInput } from './user.schema.ts';

export const UserService = {
  async findAll() {
    return await UserRepository.findAll();
  },

  async findById(id: number) {
    return await UserRepository.findById(id);
  },

  async create(data: CreateUserInput) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    const { password, confirmPassword, ...userData } = data;
    return await UserRepository.create({ ...userData, passwordHash });
  },

  async update(id: number, data: Partial<CreateUserInput>) {
    const payload: Record<string, unknown> = { ...data };
    // 业务规则：更新时若包含明文密码，必须重新哈希后再写入 DB
    if (data.password) {
      payload.passwordHash = await bcrypt.hash(data.password, 10);
      delete payload.password;
      delete payload.confirmPassword;
    }
    return await UserRepository.update(id, payload as Parameters<typeof UserRepository.update>[1]);
  },

  async delete(id: number) {
    return await UserRepository.delete(id);
  },
};
