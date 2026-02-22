import { Injectable, Logger } from '@nestjs/common';
import { IDocumentStateStore } from './state-store.interface';
import { DocumentTaskProgress, PageProcessResult } from './task-progress.interface';
import { TaskStatus } from './task-status';
import { IRedisClient } from '../common/interfaces/redis-client.interface';

/**
 * Redis 文档状态存储
 * 用于分布式环境下的任务状态持久化和断点续传
 */
@Injectable()
export class RedisDocumentStateStore implements IDocumentStateStore {
  private readonly logger = new Logger(RedisDocumentStateStore.name);
  private readonly keyPrefix = 'document:task';

  constructor(private readonly redis: IRedisClient) {}

  /**
   * 保存页面结果
   */
  async savePageResult(taskId: string, result: PageProcessResult): Promise<void> {
    const key = this.getPageResultKey(taskId, result.pageIndex);
    await this.redis.setex(
      key,
      86400 * 7, // 7天过期
      JSON.stringify({
        ...result,
        timestamp: result.timestamp.toISOString(),
        // Error 对象无法被 JSON.stringify 序列化，需手动提取
        error: result.error
          ? { message: result.error.message, stack: result.error.stack }
          : undefined,
      })
    );
  }

  /**
   * 获取页面结果
   */
  async getPageResult(taskId: string, pageIndex: number): Promise<PageProcessResult | null> {
    const key = this.getPageResultKey(taskId, pageIndex);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
        error: parsed.error ? new Error(parsed.error.message || parsed.error) : undefined,
      };
    } catch (error) {
      this.logger.error(`[${taskId}] Failed to parse page result for page ${pageIndex}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 获取所有结果
   */
  async getAllResults(taskId: string): Promise<PageProcessResult[]> {
    const pattern = `${this.keyPrefix}:${taskId}:page:*`;
    const keys = await this.safeKeys(pattern);

    if (keys.length === 0) {
      return [];
    }

    const results: PageProcessResult[] = [];
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          results.push({
            ...parsed,
            timestamp: new Date(parsed.timestamp),
            error: parsed.error ? new Error(parsed.error.message || parsed.error) : undefined,
          });
        } catch (error) {
          this.logger.error(`[${taskId}] Failed to parse page result from key ${key}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return results.sort((a, b) => a.pageIndex - b.pageIndex);
  }

  /**
   * 获取已成功处理的页码列表
   */
  async getProcessedPages(taskId: string): Promise<number[]> {
    const key = this.getProcessedPagesKey(taskId);
    const members = await this.redis.smembers(key);
    return members.map(Number).sort((a, b) => a - b);
  }

  /**
   * 获取失败的页码列表
   */
  async getFailedPages(taskId: string): Promise<number[]> {
    const key = this.getFailedPagesKey(taskId);
    const members = await this.redis.smembers(key);
    return members.map(Number).sort((a, b) => a - b);
  }

  /**
   * 更新任务进度
   */
  async updateProgress(taskId: string, progress: DocumentTaskProgress): Promise<void> {
    const key = this.getProgressKey(taskId);
    await this.redis.setex(
      key,
      86400 * 7, // 7天过期
      JSON.stringify({
        ...progress,
        startTime: progress.startTime?.toISOString(),
        endTime: progress.endTime?.toISOString(),
      })
    );
  }

  /**
   * 获取任务进度
   */
  async getProgress(taskId: string): Promise<DocumentTaskProgress | null> {
    const key = this.getProgressKey(taskId);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        startTime: parsed.startTime ? new Date(parsed.startTime) : undefined,
        endTime: parsed.endTime ? new Date(parsed.endTime) : undefined,
      };
    } catch (error) {
      this.logger.error(`[${taskId}] Failed to parse task progress`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 获取或初始化任务进度（原子操作，避免竞态条件）
   */
  async getOrCreateProgress(taskId: string, total: number): Promise<DocumentTaskProgress> {
    const key = this.getProgressKey(taskId);
    const now = new Date();

    const initData = JSON.stringify({
      total,
      completed: 0,
      failed: 0,
      percentage: 0,
      status: TaskStatus.PENDING,
      startTime: now.toISOString(),
    });

    // 使用 SET NX（仅当 key 不存在时设置）实现原子初始化
    const script = `
      local key = KEYS[1]
      local existing = redis.call('GET', key)
      if existing then
        return existing
      end
      redis.call('SETEX', key, 604800, ARGV[1])
      return ARGV[1]
    `;

    const result = await this.redis.eval(script, 1, key, initData);

    let parsed: any;
    try {
      parsed = JSON.parse(result as string);
    } catch (error) {
      this.logger.error(`[${taskId}] Failed to parse progress from Redis eval result`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // 返回初始进度作为降级
      return {
        total,
        completed: 0,
        failed: 0,
        percentage: 0,
        status: TaskStatus.PENDING,
        startTime: now,
      };
    }

    return {
      ...parsed,
      startTime: parsed.startTime ? new Date(parsed.startTime) : undefined,
      endTime: parsed.endTime ? new Date(parsed.endTime) : undefined,
    };
  }

  /**
   * 原子性地更新文档进度（使用Lua脚本）
   */
  async updateDocumentProgress(taskId: string): Promise<{
    completed: number;
    failed: number;
    percentage: number;
    isCompleted: boolean;
  } | null> {
    const progressKey = this.getProgressKey(taskId);
    const processedKey = this.getProcessedPagesKey(taskId);
    const failedKey = this.getFailedPagesKey(taskId);

    // Lua 脚本：原子性地更新进度
    const script = `
      local progressKey = KEYS[1]
      local processedKey = KEYS[2]
      local failedKey = KEYS[3]

      local progress = redis.call('GET', progressKey)
      if not progress then
        return nil
      end

      local progressData = cjson.decode(progress)
      local completed = redis.call('SCARD', processedKey)
      local failed = redis.call('SCARD', failedKey)
      local total = progressData.total

      progressData.completed = completed
      progressData.failed = failed
      if total > 0 then
        progressData.percentage = math.floor((completed + failed) / total * 100)
      else
        progressData.percentage = 0
      end

      if completed + failed >= total then
        if failed > 0 and completed == 0 then
          progressData.status = 'failed'
        else
          progressData.status = 'completed'
        end
        progressData.endTime = ARGV[1]
      end

      redis.call('SETEX', progressKey, 604800, cjson.encode(progressData))

      local result = {}
      result["completed"] = completed
      result["failed"] = failed
      result["percentage"] = progressData.percentage
      if progressData.status == 'completed' or progressData.status == 'failed' then
        result["isCompleted"] = true
      else
        result["isCompleted"] = false
      end
      return cjson.encode(result)
    `;

    const now = new Date().toISOString();

    const result = await this.redis.eval(
      script,
      3,
      progressKey,
      processedKey,
      failedKey,
      now
    );

    if (!result) {
      return null;
    }

    try {
      return JSON.parse(result as string);
    } catch (error) {
      this.logger.error(`Failed to parse updateDocumentProgress result`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 标记页面为已处理
   */
  async markPageAsProcessed(taskId: string, pageNumber: number): Promise<void> {
    const key = this.getProcessedPagesKey(taskId);
    await this.redis.sadd(key, pageNumber.toString());
    await this.redis.expire(key, 86400 * 7); // 7天过期
  }

  /**
   * 标记页面为失败
   */
  async markPageAsFailed(taskId: string, pageNumber: number): Promise<void> {
    const key = this.getFailedPagesKey(taskId);
    await this.redis.sadd(key, pageNumber.toString());
    await this.redis.expire(key, 86400 * 7); // 7天过期
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const progress = await this.getProgress(taskId);

    if (!progress) {
      return false;
    }

    progress.status = TaskStatus.CANCELLED;
    progress.endTime = new Date();
    progress.duration = progress.startTime
      ? Date.now() - progress.startTime.getTime()
      : 0;

    await this.updateProgress(taskId, progress);
    return true;
  }

  /**
   * 删除任务所有数据
   */
  async deleteTask(taskId: string): Promise<void> {
    const pattern = `${this.keyPrefix}:${taskId}:*`;
    const keys = await this.safeKeys(pattern);

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    this.logger.log(`[${taskId}] Task data deleted (${keys.length} keys)`);
  }

  /**
   * 获取进度键
   */
  private getProgressKey(taskId: string): string {
    return `${this.keyPrefix}:${taskId}:progress`;
  }

  /**
   * 获取页面结果键
   */
  private getPageResultKey(taskId: string, pageIndex: number): string {
    return `${this.keyPrefix}:${taskId}:page:${pageIndex}`;
  }

  /**
   * 获取已处理页面集合键
   */
  private getProcessedPagesKey(taskId: string): string {
    return `${this.keyPrefix}:${taskId}:processed`;
  }

  /**
   * 获取失败页面集合键
   */
  private getFailedPagesKey(taskId: string): string {
    return `${this.keyPrefix}:${taskId}:failed`;
  }

  /**
   * 安全扫描 Redis 键（优先使用 SCAN，fallback 到 KEYS）
   */
  private async safeKeys(pattern: string): Promise<string[]> {
    if (this.redis.scanKeys) {
      return this.redis.scanKeys(pattern);
    }
    return this.redis.keys(pattern);
  }
}
