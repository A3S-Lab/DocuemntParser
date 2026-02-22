/**
 * 文档处理错误基类
 */
export class DocumentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'DocumentError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 不支持的文件格式错误
 */
export class UnsupportedFormatError extends DocumentError {
  constructor(format: string, details?: Record<string, any>) {
    super(`不支持的文件格式: ${format}`, 'UNSUPPORTED_FORMAT', {
      format,
      ...details,
    });
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * 文件过大错误
 */
export class FileTooLargeError extends DocumentError {
  constructor(size: number, maxSize: number, details?: Record<string, any>) {
    super(
      `文件过大: ${size} bytes (最大: ${maxSize} bytes)`,
      'FILE_TOO_LARGE',
      {
        size,
        maxSize,
        ...details,
      }
    );
    this.name = 'FileTooLargeError';
  }
}

/**
 * 配置验证错误
 */
export class ConfigValidationError extends DocumentError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'CONFIG_VALIDATION_ERROR', details);
    this.name = 'ConfigValidationError';
  }
}

/**
 * 限流错误
 */
export class RateLimitError extends DocumentError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'RATE_LIMIT_ERROR', details);
    this.name = 'RateLimitError';
  }
}

/**
 * 熔断器错误
 */
export class CircuitBreakerError extends DocumentError {
  public readonly context?: { state?: string; name?: string };

  constructor(message: string, details?: Record<string, any>) {
    super(message, 'CIRCUIT_BREAKER_ERROR', details);
    this.name = 'CircuitBreakerError';
    this.context = details;
  }
}

/**
 * 文档验证错误
 */
export class DocumentValidationError extends DocumentError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'DOCUMENT_VALIDATION_ERROR', details);
    this.name = 'DocumentValidationError';
  }
}

/**
 * 文档加载错误
 */
export class DocumentLoadError extends DocumentError {
  constructor(message: string, public readonly cause?: Error, details?: Record<string, any>) {
    super(message, 'DOCUMENT_LOAD_ERROR', details);
    this.name = 'DocumentLoadError';
  }
}
