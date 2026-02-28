/**
 * 地址业务逻辑 — 增删改查 + 默认地址管理
 * 规则：
 *   - 每个用户最多 20 个地址
 *   - 第一个地址自动设为默认
 *   - 删除默认地址时自动将最新的另一个地址设为默认
 */
import { NotFoundError, ValidationError, ErrorCode } from '@repo/shared';
import { generateId } from '@repo/shared';
import * as addressRepo from '../repositories/address.repo';
import type { UserAddress } from '@repo/database';
import type { CreateAddressInput, UpdateAddressInput } from '../types';

const MAX_ADDRESSES = 20;

/** 获取用户所有地址 */
export async function list(userId: string): Promise<UserAddress[]> {
  return addressRepo.findByUserId(userId);
}

/** 创建地址 */
export async function create(
  userId: string,
  input: CreateAddressInput
): Promise<UserAddress> {
  // 检查地址数量上限
  const currentCount = await addressRepo.countByUserId(userId);
  if (currentCount >= MAX_ADDRESSES) {
    throw new ValidationError('收货地址数量已达上限', ErrorCode.ADDRESS_LIMIT);
  }

  // 第一个地址自动设为默认
  const isDefault = currentCount === 0 ? true : (input.isDefault ?? false);

  // 如果设为默认，先清除其他默认地址
  if (isDefault && currentCount > 0) {
    await addressRepo.clearDefault(userId);
  }

  return addressRepo.create({
    id: generateId(),
    userId,
    label: input.label ?? null,
    recipient: input.recipient,
    phone: input.phone,
    province: input.province,
    city: input.city,
    district: input.district,
    address: input.address,
    postalCode: input.postalCode ?? null,
    isDefault,
  });
}

/** 更新地址 */
export async function update(
  userId: string,
  input: UpdateAddressInput
): Promise<UserAddress> {
  // 查地址并校验归属
  const existing = await addressRepo.findById(input.id);
  if (!existing || existing.userId !== userId) {
    throw new NotFoundError('地址不存在');
  }

  // 如果设为默认，先清除其他默认
  if (input.isDefault === true) {
    await addressRepo.clearDefault(userId);
  }

  const updateData: Record<string, unknown> = {};
  if (input.label !== undefined) updateData.label = input.label;
  if (input.recipient !== undefined) updateData.recipient = input.recipient;
  if (input.phone !== undefined) updateData.phone = input.phone;
  if (input.province !== undefined) updateData.province = input.province;
  if (input.city !== undefined) updateData.city = input.city;
  if (input.district !== undefined) updateData.district = input.district;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.postalCode !== undefined) updateData.postalCode = input.postalCode;
  if (input.isDefault !== undefined) updateData.isDefault = input.isDefault;

  const updated = await addressRepo.updateById(input.id, updateData as Parameters<typeof addressRepo.updateById>[1]);
  return updated!;
}

/** 删除地址 */
export async function remove(userId: string, addressId: string): Promise<void> {
  // 查地址并校验归属
  const existing = await addressRepo.findById(addressId);
  if (!existing || existing.userId !== userId) {
    throw new NotFoundError('地址不存在');
  }

  const wasDefault = existing.isDefault;

  // 删除
  await addressRepo.deleteById(addressId);

  // 如果删的是默认地址，自动将最新的另一个地址设为默认
  if (wasDefault) {
    const latest = await addressRepo.findLatestByUserId(userId, addressId);
    if (latest) {
      await addressRepo.setDefault(latest.id);
    }
  }
}
