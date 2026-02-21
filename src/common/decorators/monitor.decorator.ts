/**
 * 性能监控装饰器
 *
 * 自动记录方法执行时间和性能指标
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(
 *     private performanceMonitor: PerformanceMonitorService,
 *   ) {}
 *
 *   @Monitor('processDocument')
 *   async processDocument(doc: Document) {
 *     // 方法执行会自动记录性能指标
 *     return await this.doProcess(doc);
 *   }
 *
 *   @Monitor() // 自动使用 ClassName.methodName
 *   async anotherMethod() {
 *     // ...
 *   }
 * }
 * ```
 */
export function Monitor(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const operation = operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (this: any, ...args: any[]) {
      const monitor = this.performanceMonitor || this.monitor;

      // 如果没有监控服务，直接执行原方法
      if (!monitor) {
        return originalMethod.apply(this, args);
      }

      // 使用监控服务记录操作
      if (monitor.recordOperation) {
        return monitor.recordOperation(operation, () => {
          return originalMethod.apply(this, args);
        });
      }

      // 降级：手动记录时间
      const startTime = Date.now();
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        if (monitor.recordSuccess) {
          monitor.recordSuccess(operation, duration);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (monitor.recordFailure) {
          monitor.recordFailure(operation, duration);
        }

        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 监控同步方法的装饰器
 *
 * @example
 * ```typescript
 * @MonitorSync('calculateHash')
 * calculateHash(data: Buffer): string {
 *   return crypto.createHash('sha256').update(data).digest('hex');
 * }
 * ```
 */
export function MonitorSync(operationName?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const operation = operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = function (this: any, ...args: any[]) {
      const monitor = this.performanceMonitor || this.monitor;

      if (!monitor) {
        return originalMethod.apply(this, args);
      }

      const startTime = Date.now();
      try {
        const result = originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        if (monitor.recordSuccess) {
          monitor.recordSuccess(operation, duration);
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (monitor.recordFailure) {
          monitor.recordFailure(operation, duration);
        }

        throw error;
      }
    };

    return descriptor;
  };
}
