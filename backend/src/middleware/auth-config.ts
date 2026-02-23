// 架构师建议：将配置项集中管理，避免硬编码
// 确保这些常量与 login.service.ts 中的保持一致，最好提取到一个单独的 config 文件中
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
export const REDIS_SESSION_PREFIX = 'user:session:';
export const JWT_EXPIRATION = 60 * 60 * 1000;
