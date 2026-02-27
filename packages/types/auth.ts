/** 用户角色 */
export type Role = "admin" | "user" | "guest";

/** 认证用户信息 */
export interface AuthUser {
  userId: string;
  role: Role;
}

/** JWT Payload */
export interface JwtPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}
