import { describe, expect, test } from 'bun:test';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  BizError,
} from './http-errors';
import { ErrorCode } from './error-codes';

describe('AppError', () => {
  test('should create with statusCode, message, errorCode, details', () => {
    const err = new AppError(400, 'test error', 'TEST_CODE', { field: 'x' });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('test error');
    expect(err.errorCode).toBe('TEST_CODE');
    expect(err.details).toEqual({ field: 'x' });
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  test('should default isOperational to true', () => {
    const err = new AppError(500, 'fail');
    expect(err.isOperational).toBe(true);
  });
});

describe('HTTP error subclasses', () => {
  test('BadRequestError → 400', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('BadRequestError');
    expect(err).toBeInstanceOf(AppError);
  });

  test('UnauthorizedError → 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('UnauthorizedError');
  });

  test('ForbiddenError → 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('ForbiddenError');
  });

  test('NotFoundError → 404', () => {
    const err = new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('用户不存在');
    expect(err.errorCode).toBe('USER_1001');
    expect(err.name).toBe('NotFoundError');
  });

  test('ConflictError → 409', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('ConflictError');
  });

  test('ValidationError → 422', () => {
    const err = new ValidationError('字段格式错误', undefined, [{ field: 'email' }]);
    expect(err.statusCode).toBe(422);
    expect(err.details).toEqual([{ field: 'email' }]);
    expect(err.name).toBe('ValidationError');
  });

  test('RateLimitError → 429', () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe('RateLimitError');
  });

  test('InternalError → 500, isOperational = false', () => {
    const err = new InternalError();
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(false);
    expect(err.name).toBe('InternalError');
  });
});

describe('BizError', () => {
  test('should accept custom statusCode + errorCode', () => {
    const err = new BizError(403, ErrorCode.ORDER_CANCEL_DENIED, '已发货不可取消');
    expect(err.statusCode).toBe(403);
    expect(err.errorCode).toBe('ORDER_4005');
    expect(err.message).toBe('已发货不可取消');
    expect(err.name).toBe('BizError');
    expect(err).toBeInstanceOf(AppError);
  });
});
