import { RateLimitError } from '../errors/document.errors';

/**
 * 限流装饰器配置
 */
export interface RateLimitOptions {
  /**
   * 限流键（用于区分不同的限流规则）
   */
  key?: string;

  /**
   * 最大请求数
   */
  maxRequests: number;

  /**
   * 时间窗口（毫秒）
   */
  windowMs: number;

  /**
   * 限流算法
   */
  algorithm?: 'token_bucket' | 'sliding_window' | 'fixed_window';

  /**
   * 自定义错误消息
   */
  errorMessage?: string;

  /**
   * 键生成函数（根据参数生成限流键）
   */
  keyGenerator?: (...args: any[]) => string;
}

/**
 * 限流装饰器
 *
 * 自动对方法进行限流保护
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class DocumentController {
 *   constructor(private rateLimiter: RateLimiterService) {}
 *
 *   @RateLimit({
 *     key: 'upload',
 *     maxRequests: 10,
 *     windowMs: 60000,
 *     algorithm: 'sliding_window'
 *   })
 *   async uploadDocument(file: Buffer) {
 *     // 自动限流，超过限制会抛出 RateLimitError
 *     return await this.processFile(file);
 *   }
 *
 *   @RateLimit({
 *     maxRequests: 100,
 *     windowMs: 60000,
 *     keyGenerator: (userId: string) => `user:${userId}:api`
 *   })
 *   async apiCall(userId: string, data: any) {
 *     // 根据用户 ID 进行限流
 *     return await this.process(data);
 *   }
 * }
 * ```
 */
export function RateLimit(options: RateLimitOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const defaultKey = options.key || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      // 获取限流服务
      const rateLimiter = this.rateLimiter || this.rateLimiterService;

      if (!rateLimiter) {
        throw new Error('RateLimiterService not found. Please inject it in your class.');
      }

      // 生成限流键
      const key = options.keyGenerator
        ? options.keyGenerator(...args)
        : defaultKey;

      // 检查限流
      const result = await rateLimiter.checkLimit(key, {
        maxRequests: options.maxRequests,
        windowMs: options.windowMs,
        algorithm: options.algorithm,
      });

      if (!result.allowed) {
        const message = options.errorMessage ||
          `请求过于频繁，请在 ${Math.ceil(result.retryAfter! / 1000)} 秒后重试`;

        throw new RateLimitError(message, {
          key,
          limit: options.maxRequests,
          window: options.windowMs,
          retryAfter: result.retryAfter,
        });
      }

      // 执行原方法
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * 用户级限流装饰器
 *
 * 根据第一个参数（用户 ID）进行限流
 *
 * @example
 * ```typescript
 * @UserRateLimit({ maxRequests: 10, windowMs: 60000 })
 * async processUserRequest(userId: string, data: any) {
 *   // 每个用户独立限流
 *   return await this.process(data);
 * }
 * ```
 */
export function UserRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
  return RateLimit({
    ...options,
    keyGenerator: (userId: string) => {
      const baseKey = options.key || 'user';
      return `${baseKey}:${userId}`;
    },
  });
}

/**
 * IP 级限流装饰器
 *
 * 根据 IP 地址进行限流（需要从请求对象中提取 IP）
 *
 * @example
 * ```typescript
 * @IpRateLimit({ maxRequests: 100, windowMs: 60000 })
 * async handleRequest(@Req() req: Request) {
 *   // 每个 IP 独立限流
 *   return await this.process(req.body);
 * }
 * ```
 */
export function IpRateLimit(options: Omit<RateLimitOptions, 'keyGenerator'>) {
  return RateLimit({
    ...options,
    keyGenerator: (req: any) => {
      const baseKey = options.key || 'ip';
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      return `${baseKey}:${ip}`;
    },
  });
}
