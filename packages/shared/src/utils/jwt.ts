/**
 * JWT 签发与验证 (jose)
 * 双 Token 机制：Access Token (短期 15m) + Refresh Token (长期 7d)
 * 使用 HS256 对称签名
 */
import * as jose from 'jose';
import { getConfig } from '../config';
import { generateId } from './id';
import { UnauthorizedError } from '../errors';
import { ErrorCode } from '../errors';
import type { AccessTokenPayload, RefreshTokenPayload, AdminAccessTokenPayload } from '../types/context';

export type { AccessTokenPayload, RefreshTokenPayload, AdminAccessTokenPayload };

/** 将 "15m" / "7d" 格式的字符串转换为 jose 可识别的过期时间 */
function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** 签发 Access Token */
export async function signAccessToken(payload: {
  sub: string;
  email: string;
}): Promise<string> {
  const config = getConfig();
  const jti = generateId();

  return new jose.SignJWT({ email: payload.email, jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.jwt.accessExpiresIn)
    .sign(encodeSecret(config.jwt.accessSecret));
}

/** 验证 Access Token，返回 payload */
export async function verifyAccessToken(
  token: string
): Promise<AccessTokenPayload> {
  const config = getConfig();
  try {
    const { payload } = await jose.jwtVerify(
      token,
      encodeSecret(config.jwt.accessSecret)
    );
    return {
      sub: payload.sub!,
      email: payload.email as string,
      jti: payload.jti!,
      iat: payload.iat!,
      exp: payload.exp!,
    };
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('登录已过期，请重新登录', ErrorCode.TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('无效的认证令牌');
  }
}

/** 签发 Refresh Token */
export async function signRefreshToken(payload: {
  sub: string;
}): Promise<string> {
  const config = getConfig();
  const jti = generateId();

  return new jose.SignJWT({ jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.jwt.refreshExpiresIn)
    .sign(encodeSecret(config.jwt.refreshSecret));
}

/** 签发 Admin Access Token（type:'staff' 标识后台人员身份，2h 有效期） */
export async function signAdminAccessToken(payload: {
  sub: string;
  username: string;
  role: string;
  isSuper: boolean;
}): Promise<string> {
  const config = getConfig();
  const jti = generateId();

  return new jose.SignJWT({
    username: payload.username,
    role: payload.role,
    isSuper: payload.isSuper,
    type: 'staff',
    jti,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(encodeSecret(config.jwt.accessSecret));
}

/** 验证 Admin Access Token，返回 payload */
export async function verifyAdminAccessToken(
  token: string
): Promise<AdminAccessTokenPayload> {
  const config = getConfig();
  try {
    const { payload } = await jose.jwtVerify(
      token,
      encodeSecret(config.jwt.accessSecret)
    );
    if (payload.type !== 'staff') {
      throw new UnauthorizedError('非后台人员令牌');
    }
    return {
      sub: payload.sub!,
      username: payload.username as string,
      role: payload.role as string,
      isSuper: payload.isSuper as boolean,
      type: 'staff',
      jti: payload.jti!,
      iat: payload.iat!,
      exp: payload.exp!,
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('登录已过期，请重新登录', ErrorCode.TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('无效的认证令牌');
  }
}

/** 验证 Refresh Token，返回 payload */
export async function verifyRefreshToken(
  token: string
): Promise<RefreshTokenPayload> {
  const config = getConfig();
  try {
    const { payload } = await jose.jwtVerify(
      token,
      encodeSecret(config.jwt.refreshSecret)
    );
    return {
      sub: payload.sub!,
      jti: payload.jti!,
      iat: payload.iat!,
      exp: payload.exp!,
    };
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('登录已过期，请重新登录', ErrorCode.TOKEN_EXPIRED);
    }
    throw new UnauthorizedError('无效的刷新令牌');
  }
}
