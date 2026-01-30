import type { Context } from 'hono';
import type { Bindings } from '../types';

// 统一错误响应格式
export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// HTTP 状态码常量
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// 错误代码常量
export const ERROR_CODES = {
  // 认证相关
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  
  // 资源相关
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  
  // 验证相关
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // 权限相关
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INSUFFICIENT_LEVEL: 'INSUFFICIENT_LEVEL',
  
  // 服务器错误
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

// 统一成功响应
export function successResponse<T>(c: Context, data: T, message?: string, status = HTTP_STATUS.OK) {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    ...(message && { message }),
  };
  return c.json(response, status);
}

// 统一错误响应
export function errorResponse(
  c: Context,
  error: string,
  code: string,
  status: number = HTTP_STATUS.BAD_REQUEST,
  details?: unknown
) {
  const response: ErrorResponse = {
    success: false,
    error,
    code,
    ...(details && { details }),
  };
  return c.json(response, status);
}

// 常用错误响应快捷方法
export const errors = {
  unauthorized: (c: Context, message = '未授权访问') => 
    errorResponse(c, message, ERROR_CODES.AUTH_UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED),
  
  forbidden: (c: Context, message = '访问被拒绝') => 
    errorResponse(c, message, ERROR_CODES.AUTH_FORBIDDEN, HTTP_STATUS.FORBIDDEN),
  
  notFound: (c: Context, resource = '资源') => 
    errorResponse(c, `${resource}不存在`, ERROR_CODES.RESOURCE_NOT_FOUND, HTTP_STATUS.NOT_FOUND),
  
  conflict: (c: Context, message = '资源已存在') => 
    errorResponse(c, message, ERROR_CODES.RESOURCE_ALREADY_EXISTS, HTTP_STATUS.CONFLICT),
  
  validation: (c: Context, details: unknown) => 
    errorResponse(c, '输入验证失败', ERROR_CODES.VALIDATION_ERROR, HTTP_STATUS.UNPROCESSABLE_ENTITY, details),
  
  permission: (c: Context, requiredLevel?: number) => 
    errorResponse(
      c, 
      requiredLevel ? `等级不足，需要达到 Lv.${requiredLevel}` : '权限不足',
      ERROR_CODES.PERMISSION_DENIED,
      HTTP_STATUS.FORBIDDEN
    ),
  
  internal: (c: Context, message = '服务器内部错误') => 
    errorResponse(c, message, ERROR_CODES.INTERNAL_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR),
};

// 日志记录器
export class Logger {
  private context: string;
  
  constructor(context: string) {
    this.context = context;
  }
  
  private log(level: string, message: string, meta?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...(meta && { meta }),
    };
    console.log(JSON.stringify(logEntry));
  }
  
  info(message: string, meta?: Record<string, unknown>) {
    this.log('INFO', message, meta);
  }
  
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>) {
    const errorMeta = error instanceof Error 
      ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
      : { error };
    this.log('ERROR', message, { ...meta, ...errorMeta });
  }
  
  warn(message: string, meta?: Record<string, unknown>) {
    this.log('WARN', message, meta);
  }
  
  debug(message: string, meta?: Record<string, unknown>) {
    this.log('DEBUG', message, meta);
  }
}

// 创建带上下文的日志记录器
export function createLogger(context: string) {
  return new Logger(context);
}

// 安全地解析整数
export function safeParseInt(value: string | undefined, defaultValue = 0): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// 获取当前 Unix 时间戳（秒）
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
