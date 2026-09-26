import type { ErrorCode, FieldIssue } from '@intellmeet/shared';

/**
 * The one HTTP status each error code maps to. Centralising this stops the
 * same logical failure returning 400 in one handler and 422 in another.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export interface AppErrorOptions {
  /** Field-level problems, surfaced to the client on validation failures. */
  details?: FieldIssue[];
  /** The original error, kept for logs only - never serialised to the client. */
  cause?: unknown;
}

/**
 * Every error the API deliberately produces.
 *
 * Throwing an `AppError` (or passing one to `next()`) is the only way a
 * handler should signal failure: the central error handler then knows the
 * status, the machine-readable code and whether the message is safe to show
 * the caller. Anything else that reaches the handler is treated as an
 * unexpected bug and reported as a generic 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: FieldIssue[];

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    Error.captureStackTrace?.(this, AppError);
  }

  /**
   * 5xx messages describe internals, so in production they are replaced with
   * a generic string before they leave the process. 4xx messages are written
   * for the caller and are safe to return as-is.
   *
   * 503 is the exception. Nothing turns a caught error into one (the handler
   * makes unknown errors 500s); every 503 is thrown on purpose with a message
   * for the person reading it - "The demo is busy right now. Please try again
   * in a few minutes" - which "Internal server error" would replace with
   * something that reads like a crash.
   */
  get isClientSafe(): boolean {
    return this.status < 500 || this.code === 'SERVICE_UNAVAILABLE';
  }

  static badRequest(message: string, options?: AppErrorOptions): AppError {
    return new AppError('BAD_REQUEST', message, options);
  }

  static validation(details: FieldIssue[], message = 'Request validation failed'): AppError {
    return new AppError('VALIDATION_ERROR', message, { details });
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', message);
  }

  static conflict(message: string, options?: AppErrorOptions): AppError {
    return new AppError('CONFLICT', message, options);
  }

  static tooManyRequests(message = 'Too many requests, please slow down'): AppError {
    return new AppError('RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error', options?: AppErrorOptions): AppError {
    return new AppError('INTERNAL_ERROR', message, options);
  }

  static unavailable(
    message = 'Service temporarily unavailable',
    options?: AppErrorOptions,
  ): AppError {
    return new AppError('SERVICE_UNAVAILABLE', message, options);
  }
}

/** Narrowing helper for `catch` blocks and the error handler. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
