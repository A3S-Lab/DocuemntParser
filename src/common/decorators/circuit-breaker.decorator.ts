import { CircuitBreakerOpenError } from '../resilience/circuit-breaker.service';
import { CircuitBreakerError } from '../errors/document.errors';

/**
 * 熔断器装饰器配置
 */
export interface CircuitBreakerOptions {
  /**
   * 熔断器名称（用于区分不同的熔断器）
   */
  name?: string;

  /**
   * 失败阈值
   */
  failureThreshold?: number;

  /**
   * 成功阈值
   */
  successThreshold?: number;

  /**
   * 超时时间（毫秒）
   */
  timeout?: number;

  /**
   * 重置超时时间（毫秒）
   */
  resetTimeout?: number;

  /**
   * 降级函数（熔断器打开时的备用逻辑）
   */
  fallback?: (...args: any[]) => any;

  /**
   * 自定义错误消息
   */
  errorMessage?: string;
}

/**
 * 熔断器装饰器
 *
 * 自动对方法进行熔断保护，防止级联故障
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class DocumentService {
 *   constructor(private circuitBreaker: CircuitBreakerService) {}
 *
 *   @CircuitBreak({
 *     name: 'processDocument',
 *     failureThreshold: 5,
 *     successThreshold: 2,
 *     timeout: 30000,
 *     resetTimeout: 60000
 *   })
 *   async processDocument(doc: Document) {
 *     // 自动熔断保护
 *     return await this.heavyProcess(doc);
 *   }
 *
 *   @CircuitBreak({
 *     name: 'externalApi',
 *     failureThreshold: 3,
 *     timeout: 5000,
 *     fallback: () => ({ data: null, cached: true })
 *   })
 *   async callExternalApi(params: any) {
 *     // 失败时返回降级数据
 *     return await this.api.call(params);
 *   }
 * }
 * ```
 */
export function CircuitBreak(options: CircuitBreakerOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = options.name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      // 获取熔断器服务
      const circuitBreaker = this.circuitBreaker || this.circuitBreakerService;

      if (!circuitBreaker) {
        throw new Error('CircuitBreakerService not found. Please inject it in your class.');
      }

      // 构建熔断器配置（过滤 undefined，避免覆盖 service 内部默认值）
      const rawConfig: Record<string, any> = {
        failureThreshold: options.failureThreshold,
        successThreshold: options.successThreshold,
        timeout: options.timeout,
        resetTimeout: options.resetTimeout,
      };
      const config = Object.keys(rawConfig).some(k => rawConfig[k] !== undefined)
        ? Object.fromEntries(Object.entries(rawConfig).filter(([, v]) => v !== undefined))
        : undefined;

      try {
        // 使用熔断器执行方法（config 作为第三个参数传入）
        return await circuitBreaker.execute(name, () => {
          return originalMethod.apply(this, args);
        }, config);
      } catch (error) {
        // 熔断器打开时触发降级或自定义错误
        const isCircuitOpen = error instanceof CircuitBreakerOpenError || error instanceof CircuitBreakerError;

        if (options.fallback && isCircuitOpen) {
          return options.fallback.apply(this, args);
        }

        if (options.errorMessage && isCircuitOpen) {
          throw new CircuitBreakerError(options.errorMessage, {
            name,
            state: (error as any).context?.state,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 快速失败装饰器
 *
 * 更激进的熔断策略，适用于非关键服务
 *
 * @example
 * ```typescript
 * @FastFail({ timeout: 3000 })
 * async getNonCriticalData() {
 *   // 快速失败，不影响主流程
 *   return await this.fetchData();
 * }
 * ```
 */
export function FastFail(options: Omit<CircuitBreakerOptions, 'failureThreshold' | 'successThreshold'> = {}) {
  return CircuitBreak({
    ...options,
    failureThreshold: 2,
    successThreshold: 1,
    timeout: options.timeout || 3000,
    resetTimeout: options.resetTimeout || 30000,
  });
}

/**
 * 容错装饰器
 *
 * 更宽容的熔断策略，适用于关键服务
 *
 * @example
 * ```typescript
 * @Resilient({ timeout: 60000 })
 * async getCriticalData() {
 *   // 容错性更强，给服务更多恢复时间
 *   return await this.fetchData();
 * }
 * ```
 */
export function Resilient(options: Omit<CircuitBreakerOptions, 'failureThreshold' | 'successThreshold'> = {}) {
  return CircuitBreak({
    ...options,
    failureThreshold: 10,
    successThreshold: 3,
    timeout: options.timeout || 60000,
    resetTimeout: options.resetTimeout || 120000,
  });
}
