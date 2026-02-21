import { Injectable, Logger } from '@nestjs/common';

/**
 * 熔断器状态
 */
export enum CircuitState {
  CLOSED = 'closed',       // 关闭状态，正常工作
  OPEN = 'open',           // 打开状态，拒绝请求
  HALF_OPEN = 'half_open', // 半开状态，尝试恢复
}

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  /** 失败阈值（失败次数） */
  failureThreshold: number;
  /** 失败率阈值（0-1） */
  failureRateThreshold?: number;
  /** 成功阈值（半开状态下需要的成功次数） */
  successThreshold: number;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 重置超时时间（毫秒，打开状态持续时间） */
  resetTimeout: number;
  /** 最小请求数（计算失败率的最小样本） */
  minimumRequests?: number;
}

/**
 * 熔断器错误
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly resetAt: number
  ) {
    super(`熔断器已打开: ${circuitName}，将在 ${new Date(resetAt).toISOString()} 重置`);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * 熔断器统计
 */
interface CircuitStats {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
}

/**
 * 熔断器实例
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private halfOpenInFlight = false;
  private stats: CircuitStats = {
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };
  private nextAttempt: number = 0;
  private readonly logger = new Logger(`CircuitBreaker:${this.name}`);

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  /**
   * 执行操作
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查熔断器状态
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerOpenError(this.name, this.nextAttempt);
      }
      // 只允许一个请求进入半开状态探测
      if (this.halfOpenInFlight) {
        throw new CircuitBreakerOpenError(this.name, this.nextAttempt);
      }
      // 进入半开状态
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenInFlight = true;
      this.logger.log(`熔断器进入半开状态`, { name: this.name });
    }

    // 执行操作
    const startTime = Date.now();
    let timer: NodeJS.Timeout | undefined;

    // 在 try 外声明，以便超时后能附加 .catch 防止 unhandled rejection
    const fnPromise = fn();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('操作超时')), this.config.timeout);
      });

      const result = await Promise.race([fnPromise, timeoutPromise]);

      clearTimeout(timer);
      this.onSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      clearTimeout(timer);

      // 超时后原始 fn() 的 Promise 可能稍后 reject，
      // 附加空 catch 防止 unhandled promise rejection
      fnPromise.catch(() => {});

      this.onFailure(error);
      throw error;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * 获取统计信息
   */
  getStats(): CircuitStats & { state: CircuitState; nextAttempt?: number } {
    return {
      ...this.stats,
      state: this.state,
      nextAttempt: this.state === CircuitState.OPEN ? this.nextAttempt : undefined,
    };
  }

  /**
   * 重置熔断器
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.halfOpenInFlight = false;
    this.stats = {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };
    this.nextAttempt = 0;
    this.logger.log(`熔断器已重置`, { name: this.name });
  }

  /**
   * 处理成功
   */
  private onSuccess(duration: number): void {
    this.stats.totalRequests++;
    this.stats.successCount++;
    this.stats.consecutiveSuccesses++;
    this.stats.consecutiveFailures = 0;
    this.stats.lastSuccessTime = Date.now();

    this.logger.debug(`操作成功`, {
      name: this.name,
      duration,
      consecutiveSuccesses: this.stats.consecutiveSuccesses,
    });

    // 半开状态下，每次探测成功后释放锁，允许下一个探测请求进入
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenInFlight = false;

      if (this.stats.consecutiveSuccesses >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.logger.log(`熔断器已关闭`, {
          name: this.name,
          consecutiveSuccesses: this.stats.consecutiveSuccesses,
        });
      }
    }
  }

  /**
   * 处理失败
   */
  private onFailure(error: any): void {
    this.stats.totalRequests++;
    this.stats.failureCount++;
    this.stats.consecutiveFailures++;
    this.stats.consecutiveSuccesses = 0;
    this.stats.lastFailureTime = Date.now();

    this.logger.warn(`操作失败`, {
      name: this.name,
      error: error instanceof Error ? error.message : String(error),
      consecutiveFailures: this.stats.consecutiveFailures,
    });

    // 检查是否需要打开熔断器
    if (this.shouldOpen()) {
      this.open();
    }
  }

  /**
   * 判断是否应该打开熔断器
   */
  private shouldOpen(): boolean {
    // 检查连续失败次数
    if (this.stats.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // 检查失败率
    if (this.config.failureRateThreshold && this.config.minimumRequests) {
      if (this.stats.totalRequests >= this.config.minimumRequests) {
        const failureRate = this.stats.failureCount / this.stats.totalRequests;
        if (failureRate >= this.config.failureRateThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 打开熔断器
   */
  private open(): void {
    this.state = CircuitState.OPEN;
    this.halfOpenInFlight = false;
    this.nextAttempt = Date.now() + this.config.resetTimeout;

    this.logger.error(`熔断器已打开`, {
      name: this.name,
      consecutiveFailures: this.stats.consecutiveFailures,
      failureRate: this.stats.failureCount / this.stats.totalRequests,
      resetAt: new Date(this.nextAttempt).toISOString(),
    });
  }
}

/**
 * 熔断器服务
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private breakers = new Map<string, CircuitBreaker>();
  /** 最大熔断器实例数，防止动态 name 导致无限增长 */
  private readonly maxBreakers = 1000;

  /**
   * 执行操作（带熔断保护）
   *
   * 如果熔断器不存在则创建，如果已存在且传入了新 config 则会被忽略（使用首次创建的配置）。
   * 如需更新配置，请先调用 remove(name) 再重新创建。
   *
   * 注意：name 应使用静态标识（如服务名），不要使用动态值（如请求 ID），
   * 否则会导致 Map 无限增长。超过上限时最早创建的熔断器会被自动移除。
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    config?: CircuitBreakerConfig
  ): Promise<T> {
    let breaker = this.breakers.get(name);

    if (!breaker) {
      // 防止无限增长：驱逐最早的熔断器
      if (this.breakers.size >= this.maxBreakers) {
        const firstKey = this.breakers.keys().next().value;
        if (firstKey !== undefined) {
          this.breakers.delete(firstKey);
          this.logger.warn(`熔断器数量达到上限 ${this.maxBreakers}，已驱逐: ${firstKey}`);
        }
      }

      const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        failureRateThreshold: 0.5,
        successThreshold: 2,
        timeout: 30000,
        resetTimeout: 60000,
        minimumRequests: 10,
        ...config,
      };

      breaker = new CircuitBreaker(name, defaultConfig);
      this.breakers.set(name, breaker);
    }

    return breaker.execute(fn);
  }

  /**
   * 获取熔断器状态
   */
  getState(name: string): CircuitState | undefined {
    return this.breakers.get(name)?.getState();
  }

  /**
   * 获取熔断器统计
   */
  getStats(name: string): ReturnType<CircuitBreaker['getStats']> | undefined {
    return this.breakers.get(name)?.getStats();
  }

  /**
   * 获取所有熔断器统计
   */
  getAllStats(): Array<{ name: string; stats: ReturnType<CircuitBreaker['getStats']> }> {
    const allStats: Array<{ name: string; stats: ReturnType<CircuitBreaker['getStats']> }> = [];

    for (const [name, breaker] of this.breakers.entries()) {
      allStats.push({
        name,
        stats: breaker.getStats(),
      });
    }

    return allStats;
  }

  /**
   * 重置熔断器
   */
  reset(name: string): void {
    this.breakers.get(name)?.reset();
  }

  /**
   * 重置所有熔断器
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    this.logger.log(`所有熔断器已重置`);
  }

  /**
   * 删除熔断器
   */
  remove(name: string): void {
    this.breakers.delete(name);
    this.logger.debug(`熔断器已删除`, { name });
  }
}
