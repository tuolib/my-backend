// 架构师建议：将配置项集中管理，避免硬编码
// 确保这些常量与 login.service.ts 中的保持一致，最好提取到一个单独的 config 文件中
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
export const REDIS_SESSION_PREFIX = 'user:session:';

// Access Token 有效期：15 分钟 (短效，用于访问资源)
export const ACCESS_TOKEN_EXPIRATION = 15 * 60; // 单位：秒

// Refresh Token 有效期：7 天 (长效，用于刷新 Access Token)
export const REFRESH_TOKEN_EXPIRATION = 7 * 24 * 60 * 60; // 单位：秒

// 兼容旧代码 (如果还有地方用 JWT_EXPIRATION)
export const JWT_EXPIRATION = ACCESS_TOKEN_EXPIRATION;
