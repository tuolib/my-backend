import { describe, expect, test } from 'bun:test';
import { success, error, paginated } from './index';
import { NotFoundError, ValidationError, AppError } from '../errors/http-errors';
import { ErrorCode } from '../errors/error-codes';

describe('success()', () => {
  test('should return correct structure', () => {
    const res = success({ id: '123', name: 'test' });
    expect(res).toEqual({
      code: 200,
      success: true,
      data: { id: '123', name: 'test' },
      message: '',
      traceId: '',
    });
  });

  test('should accept optional message', () => {
    const res = success(null, '操作成功');
    expect(res.message).toBe('操作成功');
    expect(res.data).toBeNull();
  });
});

describe('error()', () => {
  test('should return correct structure for NotFoundError', () => {
    const err = new NotFoundError('用户不存在', ErrorCode.USER_NOT_FOUND);
    const res = error(err, 'trace-123');
    expect(res).toEqual({
      code: 404,
      success: false,
      message: '用户不存在',
      data: null,
      meta: {
        code: 'USER_1001',
        message: '用户不存在',
      },
      traceId: 'trace-123',
    });
  });

  test('should include details when present', () => {
    const err = new ValidationError('校验失败', undefined, [{ field: 'email', msg: 'invalid' }]);
    const res = error(err);
    expect(res.meta.details).toEqual([{ field: 'email', msg: 'invalid' }]);
    expect(res.code).toBe(422);
  });

  test('should default errorCode to INTERNAL_ERROR', () => {
    const err = new AppError(500, 'unknown');
    const res = error(err);
    expect(res.meta.code).toBe('INTERNAL_ERROR');
    expect(res.traceId).toBe('');
  });
});

describe('paginated()', () => {
  test('should return correct paginated structure', () => {
    const items = [{ id: '1' }, { id: '2' }];
    const paginationMeta = { page: 1, pageSize: 20, total: 50, totalPages: 3 };
    const res = paginated(items, paginationMeta);

    expect(res.code).toBe(200);
    expect(res.success).toBe(true);
    expect(res.data.items).toEqual(items);
    expect(res.data.pagination).toEqual(paginationMeta);
    expect(res.traceId).toBe('');
    expect(res.message).toBe('');
  });
});
