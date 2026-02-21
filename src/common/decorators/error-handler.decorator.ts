import { Logger } from '@nestjs/common';

/**
 * 错误处理装饰器配置
 */
export interface ErrorHandlerOptions {
  /**
   * 操作名称（用于日志）
   */
  operation?: string;

  /**
   * 是否重新抛出错误
   * @default true
   */
  rethrow?: boolean;

  /**
   * 错误转换函数
   */
  transform?: (error: any) => Error;

  /**
   * 默认返回值（当 rethrow=false 时）
   */
  defaultValue?: any;

  /**
   * 自定义日志记录器
   */
  logger?: Logger;
}

/**
 * 统一错误处理装饰器
 *
 * 自动捕获、记录和转换错误
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   @HandleErrors({ operation: 'loadDocument' })
 *   async loadDocument(path: string) {
 *     // 错误会自动被捕获和记录
 *     return await fs.readFile(path);
 *   }
 *
 *   @HandleErrors({
 *     operation: 'processDocument',
 *     transform: (error) => new DocumentProcessError('处理失败', { cause: error })
 *   })
 *   async processDocument(doc: Document) {
 *     // 错误会被转换为 DocumentProcessError
 *     return await this.process(doc);
 *   }
 *
 *   @HandleErrors({
 *     operation: 'getCache',
 *     rethrow: false,
 *     defaultValue: null
 *   })
 *   async getCache(key: string) {
 *     // 错误不会抛出，返回 null
 *     return await this.cache.get(key);
 *   }
 * }
 * ```
 */
export function HandleErrors(options: ErrorHandlerOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const operation = options.operation || `${target.constructor.name}.${propertyKey}`;
    const rethrow = options.rethrow !== false;

    descriptor.value = async function (this: any, ...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        // 获取日志记录器
        const logger = options.logger || this.logger || new Logger(target.constructor.name);

        // 记录错误
        logger.error(`操作失败: ${operation}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          args: args.length > 0 ? JSON.stringify(args).substring(0, 200) : undefined,
        });

        // 转换错误
        let transformedError = error;
        if (options.transform) {
          transformedError = options.transform(error);
        }

        // 重新抛出或返回默认值
        if (rethrow) {
          throw transformedError;
        } else {
          return options.defaultValue;
        }
      }
    };

    return descriptor;
  };
}

/**
 * 同步方法的错误处理装饰器
 *
 * @example
 * ```typescript
 * @HandleErrorsSync({ operation: 'parseJson' })
 * parseJson(text: string): any {
 *   return JSON.parse(text);
 * }
 * ```
 */
export function HandleErrorsSync(options: ErrorHandlerOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const operation = options.operation || `${target.constructor.name}.${propertyKey}`;
    const rethrow = options.rethrow !== false;

    descriptor.value = function (this: any, ...args: any[]) {
      try {
        return originalMethod.apply(this, args);
      } catch (error) {
        const logger = options.logger || this.logger || new Logger(target.constructor.name);

        logger.error(`操作失败: ${operation}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        let transformedError = error;
        if (options.transform) {
          transformedError = options.transform(error);
        }

        if (rethrow) {
          throw transformedError;
        } else {
          return options.defaultValue;
        }
      }
    };

    return descriptor;
  };
}

/**
 * 重试装饰器
 *
 * 自动重试失败的操作
 *
 * @example
 * ```typescript
 * @Retry({ maxAttempts: 3, delay: 1000 })
 * async fetchData(url: string) {
 *   return await fetch(url);
 * }
 * ```
 */
export function Retry(options: {
  maxAttempts?: number;
  delay?: number;
  backoff?: 'linear' | 'exponential';
  retryIf?: (error: any) => boolean;
} = {}) {
  const maxAttempts = options.maxAttempts || 3;
  const delay = options.delay || 1000;
  const backoff = options.backoff || 'exponential';
  const retryIf = options.retryIf || (() => true);

  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: any, ...args: any[]) {
      let lastError: any;
      const logger = this.logger || new Logger(target.constructor.name);

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          lastError = error;

          // 检查是否应该重试
          if (attempt === maxAttempts || !retryIf(error)) {
            throw error;
          }

          // 计算延迟时间
          const waitTime = backoff === 'exponential'
            ? delay * Math.pow(2, attempt - 1)
            : delay * attempt;

          logger.warn(`操作失败，${waitTime}ms 后重试 (${attempt}/${maxAttempts})`, {
            method: `${target.constructor.name}.${propertyKey}`,
            error: error instanceof Error ? error.message : String(error),
          });

          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      throw lastError;
    };

    return descriptor;
  };
}
