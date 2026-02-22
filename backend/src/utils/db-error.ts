// 解析 Drizzle/Postgres 错误并返回友好的信息和状态码
export const parseDbError = (err: any) => {
  // 核心：提取 Drizzle 包装的原始错误 (cause)
  const originError = err.cause || err;
  const errorCode = originError.code;

  // 架构师定义的错误映射表
  const errorMap: Record<string, { message: string; status: number }> = {
    '23505': { message: '数据已存在，请检查重复项', status: 400 },
    '23503': { message: '关联数据不存在（外键约束错误）', status: 400 },
    '23502': { message: '必填字段不能为空', status: 400 },
    '42P01': { message: '数据库表不存在', status: 500 },
  };

  // 默认错误
  return {
    message: err.message || '数据库操作异常',
    status: 500,
    errorCode
  };
};