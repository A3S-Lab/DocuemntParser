import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * 限流算法类型
 */
export enum RateLimitAlgorithm {
  TOKEN_BUCKET = 'token_bucket',
  SLIDING_WINDOW = 'sliding_window',
  FIXED_WINDOW = 'fixed_window',
}

/**
 * 限流配置
 */
export interface RateLimitConfig {
  /** 限流算法 */
  algorithm?: RateLimitAlgorithm;
  /** 最大请求数 */
  maxRequests: number;
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 令牌桶容量（仅用于 TOKEN_BUCKET） */
  capacity?: number;
  /** 令牌填充速率（每秒，仅用于 TOKEN_BUCKET） */
  refillRate?: number;
}

/**
 * 限流结果
 */
export interface RateLimitResult {
  /** 是否允许 */
  allowed: boolean;
  /** 剩余配额 */
  remaining: number;
  /** 重置时间（毫秒时间戳） */
  resetAt: number;
  /** 重试延迟（毫秒） */
  retryAfter?: number;
}

/**
 * 令牌桶
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  getRemaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  getCapacity(): number {
    return this.capacity;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // 转换为秒
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * 滑动窗口
 */
class SlidingWindow {
  private requests: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  tryConsume(): boolean {
    const now = Date.now();
    this.cleanup(now);

    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }

    return false;
  }

  getRemaining(): number {
    this.cleanup(Date.now());
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  getResetAt(): number {
    if (this.requests.length === 0) {
      return Date.now();
    }
    return this.requests[0] + this.windowMs;
  }

  private cleanup(now: number): void {
    const cutoff = now - this.windowMs;
    // 使用二分查找找到第一个有效的时间戳
    let low = 0;
    let high = this.requests.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.requests[mid] <= cutoff) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    if (low > 0) {
      // splice 原地移除，避免 slice 创建完整副本
      this.requests.splice(0, low);
    }
  }
}

/**
 * 固定窗口
 */
class FixedWindow {
  private count: number = 0;
  private windowStart: number;

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {
    this.windowStart = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    this.resetIfNeeded(now);

    if (this.count < this.maxRequests) {
      this.count++;
      return true;
    }

    return false;
  }

  getRemaining(): number {
    this.resetIfNeeded(Date.now());
    return Math.max(0, this.maxRequests - this.count);
  }

  getResetAt(): number {
    return this.windowStart + this.windowMs;
  }

  private resetIfNeeded(now: number): void {
    if (now >= this.windowStart + this.windowMs) {
      this.count = 0;
      this.windowStart = now;
    }
  }
}

/**
 * 限流服务
 */
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private limiters = new Map<string, TokenBucket | SlidingWindow | FixedWindow>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // 每 10 分钟清理一次空闲的限流器
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleLimiters();
    }, 600000);
    // 不阻止进程正常退出
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * 检查是否允许请求
   *
   * 如果 key 对应的限流器已存在，则复用（忽略新 config）。
   * 如需更新配置，请先调用 reset(key) 再重新请求。
   */
  async checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    let limiter = this.limiters.get(key);

    if (!limiter) {
      limiter = this.createLimiter(config);
      this.limiters.set(key, limiter);
    }

    const allowed = limiter.tryConsume();
    const remaining = limiter.getRemaining();
    const resetAt = this.getResetAt(limiter);

    if (!allowed) {
      const retryAfter = Math.max(0, resetAt - Date.now());
      this.logger.warn(`限流触发`, {
        key,
        remaining,
        resetAt: new Date(resetAt).toISOString(),
        retryAfter,
      });

      return {
        allowed: false,
        remaining,
        resetAt,
        retryAfter,
      };
    }

    this.logger.debug(`限流检查通过`, {
      key,
      remaining,
    });

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  /**
   * 重置限流器
   */
  reset(key: string): void {
    this.limiters.delete(key);
    this.logger.debug(`限流器已重置`, { key });
  }

  /**
   * 清空所有限流器
   */
  resetAll(): void {
    const count = this.limiters.size;
    this.limiters.clear();
    this.logger.log(`所有限流器已清空`, { count });
  }

  /**
   * 获取限流器统计
   */
  getStats(): Array<{ key: string; remaining: number; resetAt: number }> {
    const stats: Array<{ key: string; remaining: number; resetAt: number }> = [];

    for (const [key, limiter] of this.limiters.entries()) {
      stats.push({
        key,
        remaining: limiter.getRemaining(),
        resetAt: this.getResetAt(limiter),
      });
    }

    return stats;
  }

  /**
   * 清理空闲的限流器（配额已满恢复的限流器）
   */
  private cleanupStaleLimiters(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, limiter] of this.limiters.entries()) {
      if (limiter instanceof SlidingWindow || limiter instanceof FixedWindow) {
        const resetAt = limiter.getResetAt();
        if (resetAt <= now && limiter.getRemaining() > 0) {
          this.limiters.delete(key);
          cleanedCount++;
        }
      } else if (limiter instanceof TokenBucket) {
        // TokenBucket 配额已满说明长时间无请求，可以清理
        if (limiter.getRemaining() >= limiter.getCapacity()) {
          this.limiters.delete(key);
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理空闲限流器`, { cleanedCount, remaining: this.limiters.size });
    }
  }

  /**
   * 创建限流器
   */
  private createLimiter(config: RateLimitConfig): TokenBucket | SlidingWindow | FixedWindow {
    const algorithm = config.algorithm || RateLimitAlgorithm.SLIDING_WINDOW;

    switch (algorithm) {
      case RateLimitAlgorithm.TOKEN_BUCKET:
        return new TokenBucket(
          config.capacity || config.maxRequests,
          config.refillRate || config.maxRequests / (config.windowMs / 1000)
        );

      case RateLimitAlgorithm.SLIDING_WINDOW:
        return new SlidingWindow(config.maxRequests, config.windowMs);

      case RateLimitAlgorithm.FIXED_WINDOW:
        return new FixedWindow(config.maxRequests, config.windowMs);

      default:
        return new SlidingWindow(config.maxRequests, config.windowMs);
    }
  }

  /**
   * 获取重置时间
   */
  private getResetAt(limiter: TokenBucket | SlidingWindow | FixedWindow): number {
    if (limiter instanceof SlidingWindow || limiter instanceof FixedWindow) {
      return limiter.getResetAt();
    }
    // TokenBucket 没有固定的重置时间
    return Date.now() + 60000; // 默认 1 分钟后
  }
}
