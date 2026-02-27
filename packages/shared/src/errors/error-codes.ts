/** 业务错误码枚举 */
export const ErrorCode = {
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
