export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: Record<string, unknown>;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { success: true, data, error: null, ...(meta && { meta }) };
}

export function fail(error: string, meta?: Record<string, unknown>): ApiResponse<null> {
  return { success: false, data: null, error, ...(meta && { meta }) };
}
