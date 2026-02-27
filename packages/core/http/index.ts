/** HTTP 方法类型 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/** 常用 HTTP 状态码 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** 常用 Content-Type */
export const ContentType = {
  JSON: "application/json",
  FORM: "application/x-www-form-urlencoded",
  MULTIPART: "multipart/form-data",
  TEXT: "text/plain",
  HTML: "text/html",
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];
