import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Document } from '../../models/document.model';

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  size: number;
}

/**
 * 缓存键生成器
 */
export class CacheKeyGenerator {
  /**
   * 为文件生成缓存键
   */
  static forFile(filename: string, options?: Record<string, any>): string {
    const optionsStr = options ? JSON.stringify(options) : '';
    return `file:${filename}:${optionsStr}`;
  }

  /**
   * 为 Buffer 生成缓存键（使用内容哈希避免碰撞）
   */
  static forBuffer(buffer: Buffer, filename: string): string {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    return `buffer:${filename}:${hash}`;
  }
}

/** 默认最大缓存条目数 */
const DEFAULT_MAX_SIZE = 500;

/**
 * 文档缓存服务
 */
@Injectable()
export class DocumentCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentCacheService.name);
  private readonly cache = new Map<string, CacheEntry<Document[]>>();
  private readonly defaultTTL: number;
  private readonly maxSize: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(ttl: number = 3600000, maxSize: number = DEFAULT_MAX_SIZE) {
    this.defaultTTL = ttl;
    this.maxSize = maxSize;
    this.startCleanup();
  }

  /**
   * 获取缓存
   */
  get(key: string): Document[] | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.logger.debug(`缓存未命中`, { key });
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.logger.debug(`缓存已过期`, { key });
      this.cache.delete(key);
      return null;
    }

    this.logger.debug(`缓存命中`, { key });
    return entry.value;
  }

  /**
   * 设置缓存
   */
  set(key: string, value: Document[], ttl?: number): void {
    // 检查是否超过最大条目数，执行淘汰
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    const expiresAt = Date.now() + (ttl || this.defaultTTL);

    this.cache.set(key, {
      value,
      expiresAt,
      size: value.length,
    });

    this.logger.debug(`缓存已设置`, {
      key,
      documentCount: value.length,
      ttl: ttl || this.defaultTTL,
    });
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug(`缓存已删除`, { key });
    }
    return deleted;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`缓存已清空`, { clearedCount: size });
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    maxSize: number;
    keys: string[];
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * 淘汰最早过期的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < oldestExpiry) {
        oldestKey = key;
        oldestExpiry = entry.expiresAt;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`缓存淘汰`, { key: oldestKey });
    }
  }

  /**
   * 启动定期清理过期缓存
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

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`清理过期缓存`, { cleanedCount });
    }
  }

  /**
   * 停止清理定时器
   */
  onModuleDestroy(): void {
    this.destroy();
  }

  /**
   * 手动销毁（用于 useFactory 创建的实例，NestJS 不会调用 onModuleDestroy）
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
