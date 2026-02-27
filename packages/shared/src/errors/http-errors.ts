import { ErrorCode } from './error-codes';

/** 应用错误基类 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string | number) {
    super(404, id ? `${resource} #${id} not found` : `${resource} not found`, ErrorCode.NOT_FOUND);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, ErrorCode.VALIDATION_ERROR);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, ErrorCode.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, ErrorCode.FORBIDDEN);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, ErrorCode.CONFLICT);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, message, ErrorCode.INTERNAL_ERROR);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, message, ErrorCode.TOO_MANY_REQUESTS);
  }
}
