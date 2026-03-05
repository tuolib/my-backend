/**
 * User Service — 本服务 TS 类型定义
 * 用于 service 层输入/输出，不含密码等敏感字段
 */

/** 用户资料（API 响应用，不含 password） */
export interface UserProfile {
  id: string;
  email: string;
  nickname: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: string;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 注册输入 */
export interface RegisterInput {
  email: string;
  password: string;
  nickname?: string;
}

/** 登录输入 */
export interface LoginInput {
  email: string;
  password: string;
}

/** 更新用户资料输入 */
export interface UpdateUserInput {
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
}

/** 创建地址输入 */
export interface CreateAddressInput {
  label?: string;
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
  postalCode?: string;
  isDefault?: boolean;
}

/** 更新地址输入 */
export interface UpdateAddressInput {
  id: string;
  label?: string;
  recipient?: string;
  phone?: string;
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  postalCode?: string;
  isDefault?: boolean;
}

/** 认证结果（注册/登录返回） */
export interface AuthResult {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

// ── Admin Types ──

/** 管理员资料（API 响应用，不含 password） */
export interface AdminProfile {
  id: string;
  username: string;
  realName: string | null;
  role: string;
  isSuper: boolean;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** 管理员登录输入 */
export interface AdminLoginInput {
  username: string;
  password: string;
}

/** 管理员修改密码输入 */
export interface AdminChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

/** 创建管理员输入 */
export interface CreateAdminInput {
  username: string;
  password: string;
  realName?: string;
  phone?: string;
  email?: string;
  role: string;
}

/** 更新管理员输入 */
export interface UpdateAdminInput {
  id: string;
  realName?: string;
  phone?: string;
  email?: string;
  role?: string;
}

/** 管理员列表查询输入 */
export interface AdminListInput {
  page: number;
  pageSize: number;
  keyword?: string;
}

/** 管理员登录结果 */
export interface AdminLoginResult {
  admin: AdminProfile;
  accessToken: string;
  mustChangePassword: boolean;
}

/** Token 对（刷新返回） */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}
