import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Document } from '../../models/document.model';
import { IRedisClient } from '../interfaces/redis-client.interface';

/**
 * 缓存层级
 */
export enum CacheLevel {
  L1_MEMORY = 'l1_memory',
  L2_REDIS = 'l2_redis',
}

/**
 * 多级缓存配置
 */
export interface MultiLevelCacheConfig {
  /** L1 缓存 TTL（毫秒） */
  l1TTL: number;
  /** L2 缓存 TTL（毫秒） */
  l2TTL: number;
  /** L1 缓存最大条目数 */
  l1MaxSize: number;
  /** 是否启用 L2 缓存 */
  enableL2: boolean;
}

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  lastAccessed: number;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  l1: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  l2?: {
    hits: number;
    misses: number;
    hitRate: number;
  };
  overall: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

/**
 * 多级缓存服务
 */
@Injectable()
export class MultiLevelCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(MultiLevelCacheService.name);

  // L1 缓存（内存）
  private readonly l1Cache = new Map<string, CacheEntry<Document[]>>();

  // 统计信息
  private stats = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
  };

  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: MultiLevelCacheConfig,
    private readonly redisClient?: IRedisClient
  ) {
    this.startCleanup();
    this.logger.log('多级缓存服务已初始化', {
      l1TTL: config.l1TTL,
      l2TTL: config.l2TTL,
      l1MaxSize: config.l1MaxSize,
      enableL2: config.enableL2 && !!redisClient,
    });
  }

  /**
   * 获取缓存
   */
  async get(key: string): Promise<Document[] | null> {
    // 尝试从 L1 缓存获取
    const l1Result = this.getFromL1(key);
    if (l1Result) {
      this.stats.l1Hits++;
      this.logger.debug(`L1 缓存命中`, { key });
      return l1Result;
    }

    this.stats.l1Misses++;

    // 如果启用了 L2 缓存，尝试从 Redis 获取
    if (this.config.enableL2 && this.redisClient) {
      const l2Result = await this.getFromL2(key);
      if (l2Result) {
        this.stats.l2Hits++;
        this.logger.debug(`L2 缓存命中`, { key });

        // 回填到 L1 缓存
        this.setToL1(key, l2Result, this.config.l1TTL);

        return l2Result;
      }

      this.stats.l2Misses++;
    }

    this.logger.debug(`缓存未命中`, { key });
    return null;
  }

  /**
   * 设置缓存
   */
  async set(key: string, value: Document[], ttl?: number): Promise<void> {
    const l1TTL = ttl || this.config.l1TTL;
    const l2TTL = ttl || this.config.l2TTL;

    // 设置到 L1 缓存
    this.setToL1(key, value, l1TTL);

    // 如果启用了 L2 缓存，设置到 Redis
    if (this.config.enableL2 && this.redisClient) {
      await this.setToL2(key, value, l2TTL);
    }

    this.logger.debug(`缓存已设置`, {
      key,
      documentCount: value.length,
      l1TTL,
      l2TTL,
    });
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<void> {
    // 从 L1 删除
    this.l1Cache.delete(key);

    // 从 L2 删除
    if (this.config.enableL2 && this.redisClient) {
      try {
        await this.redisClient.del(this.getRedisKey(key));
      } catch (error) {
        this.logger.error(`从 Redis 删除缓存失败`, {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug(`缓存已删除`, { key });
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const l1Size = this.l1Cache.size;
    this.l1Cache.clear();

    if (this.config.enableL2 && this.redisClient) {
      try {
        // 删除所有文档缓存键（优先使用 SCAN）
        const pattern = this.getRedisKey('*');
        const keys = this.redisClient.scanKeys
          ? await this.redisClient.scanKeys(pattern)
          : await this.redisClient.keys(pattern);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } catch (error) {
        this.logger.error(`清空 Redis 缓存失败`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(`缓存已清空`, { l1Size });
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const l1Total = this.stats.l1Hits + this.stats.l1Misses;
    const l2Total = this.stats.l2Hits + this.stats.l2Misses;
    const overallTotal = l1Total + l2Total;

    return {
      l1: {
        size: this.l1Cache.size,
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: l1Total > 0 ? this.stats.l1Hits / l1Total : 0,
      },
      l2: this.config.enableL2
        ? {
            hits: this.stats.l2Hits,
            misses: this.stats.l2Misses,
            hitRate: l2Total > 0 ? this.stats.l2Hits / l2Total : 0,
          }
        : undefined,
      overall: {
        hits: this.stats.l1Hits + this.stats.l2Hits,
        misses: this.stats.l1Misses + this.stats.l2Misses,
        hitRate: overallTotal > 0 ? (this.stats.l1Hits + this.stats.l2Hits) / overallTotal : 0,
      },
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
    };
    this.logger.debug(`统计已重置`);
  }

  /**
   * 从 L1 缓存获取
   */
  private getFromL1(key: string): Document[] | null {
    const entry = this.l1Cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.l1Cache.delete(key);
      return null;
    }

    // 更新最近访问时间
    entry.lastAccessed = Date.now();

    return entry.value;
  }

  /**
   * 设置到 L1 缓存
   */
  private setToL1(key: string, value: Document[], ttl: number): void {
    // 检查是否超过最大大小
    if (this.l1Cache.size >= this.config.l1MaxSize) {
      this.evictL1();
    }

    const now = Date.now();
    this.l1Cache.set(key, {
      value,
      expiresAt: now + ttl,
      createdAt: now,
      lastAccessed: now,
    });
  }

  /**
   * 从 L2 缓存（Redis）获取
   */
  private async getFromL2(key: string): Promise<Document[] | null> {
    if (!this.redisClient) return null;
    try {
      const redisKey = this.getRedisKey(key);
      const data = await this.redisClient.get(redisKey);

      if (!data) {
        return null;
      }

      // 反序列化
      const parsed = JSON.parse(data);
      return parsed.map((doc: any) => new Document(doc));
    } catch (error) {
      this.logger.error(`从 Redis 获取缓存失败`, {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 设置到 L2 缓存（Redis）
   */
  private async setToL2(key: string, value: Document[], ttl: number): Promise<void> {
    if (!this.redisClient) return;
    try {
      const redisKey = this.getRedisKey(key);
      const data = JSON.stringify(value);

      await this.redisClient.setex(redisKey, Math.floor(ttl / 1000), data);
    } catch (error) {
      this.logger.error(`设置 Redis 缓存失败`, {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * L1 缓存淘汰（LRU — 淘汰最久未访问的条目）
   */
  private evictL1(): void {
    let lruKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.l1Cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        lruKey = key;
        oldestAccess = entry.lastAccessed;
      }
    }

    if (lruKey) {
      this.l1Cache.delete(lruKey);
      this.logger.debug(`L1 缓存淘汰`, { key: lruKey });
    }
  }

  /**
   * 获取 Redis 键
   */
  private getRedisKey(key: string): string {
    return `document:cache:${key}`;
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): void {
    // 每 5 分钟清理一次过期缓存
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 300000);
    // 不阻止进程正常退出
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * 清理过期缓存
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.l1Cache.entries()) {
      if (now > entry.expiresAt) {
        this.l1Cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理过期缓存`, { cleanedCount });
    }
  }

  /**
   * 停止清理定时器（NestJS 生命周期）
   */
  onModuleDestroy(): void {
    this.destroy();
  }

  /**
   * 手动销毁（用于 useFactory 创建的实例）
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
