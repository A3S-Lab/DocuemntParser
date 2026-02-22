import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { IDocumentStateStore } from './state-store.interface';
import { DocumentTaskProgress, DocumentTaskResult, PageProcessResult, IPageProcessCallback } from './task-progress.interface';
import { DocumentTaskConfig } from './task-config.interface';
import { TaskStatus } from './task-status';
import { PageResultStatus } from './page-result-status';
import { IRedisClient } from '../common/interfaces/redis-client.interface';

export const STATE_STORE_TOKEN = 'DOCUMENT_STATE_STORE';

/**
 * 文档任务管理服务
 *
 * 提供两种模式的任务管理：
 * 1. 分页模式（仅用于扫描 PDF）：按页处理，显示详细进度
 * 2. 整体模式（其他文档类型）：一次性处理，只显示任务状态
 *
 * @example
 * ```typescript
 * // 扫描 PDF - 分页处理
 * const result = await taskService.processWithPagination(
 *   'task-123',
 *   buffer,
 *   'scanned.pdf',
 *   async (pageIndex, totalPages) => {
 *     return await ocrService.recognizePage(buffer, pageIndex);
 *   },
 *   callback
 * );
 *
 * // 其他文档 - 整体处理
 * const result = await taskService.processAsWhole(
 *   'task-456',
 *   'document.docx',
 *   async () => {
 *     return await wordLoader.load(buffer);
 *   }
 * );
 * ```
 */
@Injectable()
export class DocumentTaskService {
  private readonly logger = new Logger(DocumentTaskService.name);

  constructor(
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: IRedisClient,
    @Optional() @Inject(STATE_STORE_TOKEN) private readonly stateStore?: IDocumentStateStore,
  ) {
    if (!this.redis || !this.stateStore) {
      this.logger.warn(
        'Redis client or state store not provided. Task management features will be disabled.'
      );
    }
  }

  /**
   * 检查任务管理是否可用
   */
  isTaskManagementEnabled(): boolean {
    return !!(this.redis && this.stateStore);
  }

  /**
   * 分页处理（仅用于扫描 PDF）
   *
   * 按页处理，支持断点续传和详细进度
   */
  async processWithPagination(
    taskId: string,
    buffer: Buffer,
    filename: string,
    pageProcessor: (pageIndex: number, totalPages: number) => Promise<string>,
    callback?: IPageProcessCallback,
    config?: DocumentTaskConfig,
  ): Promise<DocumentTaskResult> {
    if (!this.isTaskManagementEnabled()) {
      throw new Error('Task management is not enabled. Please provide Redis client and state store.');
    }

    this.logger.log(`[${taskId}] Starting paginated processing: ${filename}`);

    try {
      // 1. 获取总页数
      const totalPages = await this.getTotalPages(buffer, filename);

      // 2. 获取或创建进度
      const progress = await this.stateStore!.getOrCreateProgress(taskId, totalPages);

      // 3. 检查是否已完成
      if (progress.status === TaskStatus.COMPLETED) {
        this.logger.log(`[${taskId}] Task already completed`);
        return {
          taskId,
          totalPages,
          completedPages: progress.completed,
          failedPages: progress.failed,
          results: [],
        };
      }

      // 4. 更新状态为处理中
      await this.stateStore!.updateProgress(taskId, {
        ...progress,
        status: TaskStatus.PROCESSING,
      });

      // 5. 确定需要处理的页面（断点续传）
      const pagesToProcess = await this.determinePagesToProcess(taskId, totalPages, config);

      this.logger.log(`[${taskId}] Pages to process: ${pagesToProcess.length}/${totalPages}`);

      // 6. 处理每一页
      const results: PageProcessResult[] = [];

      for (const pageIndex of pagesToProcess) {
        // 检查任务是否已被取消
        const currentProgress = await this.stateStore!.getProgress(taskId);
        if (currentProgress?.status === TaskStatus.CANCELLED) {
          this.logger.log(`[${taskId}] Task cancelled, stopping processing`);
          break;
        }

        try {
          const startTime = Date.now();

          // 调用页面处理函数
          const text = await pageProcessor(pageIndex, totalPages);

          const duration = Date.now() - startTime;

          // 构建成功结果
          const pageResult: PageProcessResult = {
            pageIndex,
            status: PageResultStatus.SUCCESS,
            text,
            duration,
            timestamp: new Date(),
          };

          // 保存结果
          await this.stateStore!.savePageResult(taskId, pageResult);
          await this.stateStore!.markPageAsProcessed(taskId, pageIndex);

          results.push(pageResult);

          // 调用成功回调
          if (callback?.onPageSuccess) {
            await callback.onPageSuccess(taskId, pageResult);
          }

          this.logger.debug(`[${taskId}] Page ${pageIndex}/${totalPages} processed (${duration}ms)`);
        } catch (error: any) {
          this.logger.error(`[${taskId}] Page ${pageIndex} failed: ${error.message}`, error.stack);

          // 构建失败结果
          const pageResult: PageProcessResult = {
            pageIndex,
            status: PageResultStatus.FAILED,
            error: error instanceof Error ? error : new Error(String(error)),
            duration: 0,
            timestamp: new Date(),
          };

          // 保存失败结果
          await this.stateStore!.savePageResult(taskId, pageResult);
          await this.stateStore!.markPageAsFailed(taskId, pageIndex);

          results.push(pageResult);

          // 调用失败回调
          if (callback?.onPageFailed) {
            await callback.onPageFailed(taskId, pageResult);
          }
        }
      }

      // 7. 更新最终进度
      await this.stateStore!.updateDocumentProgress(taskId);

      this.logger.log(`[${taskId}] Paginated processing completed`);

      const finalProgress = await this.stateStore!.getProgress(taskId);
      return {
        taskId,
        totalPages,
        completedPages: finalProgress?.completed || 0,
        failedPages: finalProgress?.failed || 0,
        results,
      };
    } catch (error: any) {
      this.logger.error(`[${taskId}] Failed to process document: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 整体处理（用于其他文档类型）
   *
   * 一次性处理，只显示任务状态（pending -> processing -> completed）
   */
  async processAsWhole(
    taskId: string,
    filename: string,
    processor: () => Promise<any>,
  ): Promise<{ taskId: string; status: TaskStatus; result?: any; error?: Error }> {
    if (!this.isTaskManagementEnabled()) {
      throw new Error('Task management is not enabled. Please provide Redis client and state store.');
    }

    this.logger.log(`[${taskId}] Starting whole document processing: ${filename}`);

    try {
      // 1. 创建进度（总页数为 1，表示整体处理）
      const progress = await this.stateStore!.getOrCreateProgress(taskId, 1);

      // 2. 检查是否已完成
      if (progress.status === TaskStatus.COMPLETED) {
        this.logger.log(`[${taskId}] Task already completed`);
        return {
          taskId,
          status: TaskStatus.COMPLETED,
        };
      }

      // 3. 更新状态为处理中
      await this.stateStore!.updateProgress(taskId, {
        ...progress,
        status: TaskStatus.PROCESSING,
        startTime: new Date(),
      });

      // 4. 执行处理
      const startTime = Date.now();
      const result = await processor();
      const duration = Date.now() - startTime;

      // 5. 标记为完成
      await this.stateStore!.markPageAsProcessed(taskId, 1);
      await this.stateStore!.updateProgress(taskId, {
        total: 1,
        completed: 1,
        failed: 0,
        percentage: 100,
        status: TaskStatus.COMPLETED,
        startTime: progress.startTime,
        endTime: new Date(),
        duration,
      });

      this.logger.log(`[${taskId}] Whole document processing completed (${duration}ms)`);

      return {
        taskId,
        status: TaskStatus.COMPLETED,
        result,
      };
    } catch (error: any) {
      this.logger.error(`[${taskId}] Failed to process document: ${error.message}`, error.stack);

      // 标记为失败（Redis 可能也不可用，需要容错）
      try {
        await this.stateStore!.markPageAsFailed(taskId, 1);
        await this.stateStore!.updateProgress(taskId, {
          total: 1,
          completed: 0,
          failed: 1,
          percentage: 0,
          status: TaskStatus.FAILED,
          endTime: new Date(),
        });
      } catch (stateError: any) {
        this.logger.error(`[${taskId}] Failed to update task state: ${stateError.message}`);
      }

      return {
        taskId,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * 获取 PDF 总页数
   */
  private async getTotalPages(buffer: Buffer, _filename: string): Promise<number> {
    // 优先使用 pdf-lib（轻量，只解析页数，不提取文本）
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return pdfDoc.getPageCount();
    } catch {
      // pdf-lib 不可用，fallback 到 pdf-parse v2
    }

    try {
      const pdfParseModule = await import('pdf-parse');
      const PDFParse = (pdfParseModule as any).PDFParse;
      const parser = new PDFParse({ data: buffer, verbosity: 0 });
      try {
        await parser.load();
        const info = await parser.getInfo();
        return info.total || 1;
      } finally {
        await parser.destroy().catch(() => {});
      }
    } catch (error) {
      this.logger.warn('Failed to get PDF page count, defaulting to 1', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 1;
    }
  }

  /**
   * 确定需要处理的页面（支持断点续传）
   */
  private async determinePagesToProcess(
    taskId: string,
    totalPages: number,
    config?: DocumentTaskConfig,
  ): Promise<number[]> {
    // 获取已处理的页面
    const processedPages = await this.stateStore!.getProcessedPages(taskId);
    const processedSet = new Set(processedPages);

    // 如果指定了只处理的页面
    if (config?.processOnlyPages && config.processOnlyPages.length > 0) {
      return config.processOnlyPages.filter(page => {
        // 必须在有效范围内
        if (page < 1 || page > totalPages) {
          return false;
        }
        // 跳过已处理的页面
        if (processedSet.has(page)) {
          return false;
        }
        // 跳过需要跳过的页面
        if (config?.skipPages && config.skipPages.includes(page)) {
          return false;
        }
        return true;
      });
    }

    // 生成所有页码
    const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);

    // 过滤掉已处理和需要跳过的页面
    return allPages.filter(page => {
      // 如果已经成功处理，跳过
      if (processedSet.has(page)) {
        return false;
      }

      // 如果在跳过列表中，跳过
      if (config?.skipPages && config.skipPages.includes(page)) {
        return false;
      }

      return true;
    });
  }

  /**
   * 获取任务进度
   */
  async getTaskProgress(taskId: string): Promise<DocumentTaskProgress | null> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    return await this.stateStore.getProgress(taskId);
  }

  /**
   * 获取任务状态（包含详细信息）
   */
  async getTaskStatus(taskId: string): Promise<{
    progress: DocumentTaskProgress | null;
    processedPages: number[];
    failedPages: number[];
  }> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    const progress = await this.stateStore.getProgress(taskId);
    const processedPages = await this.stateStore.getProcessedPages(taskId);
    const failedPages = await this.stateStore.getFailedPages(taskId);

    return {
      progress,
      processedPages,
      failedPages,
    };
  }

  /**
   * 获取页面处理结果（仅用于分页处理）
   */
  async getPageResult(taskId: string, pageIndex: number): Promise<PageProcessResult | null> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    return await this.stateStore.getPageResult(taskId, pageIndex);
  }

  /**
   * 获取所有页面的处理结果（仅用于分页处理）
   */
  async getAllPageResults(taskId: string): Promise<PageProcessResult[]> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    return await this.stateStore.getAllResults(taskId);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    const cancelled = await this.stateStore.cancelTask(taskId);

    if (cancelled) {
      this.logger.log(`[${taskId}] Task cancelled`);
    }

    return cancelled;
  }

  /**
   * 删除任务数据
   */
  async deleteTask(taskId: string): Promise<void> {
    if (!this.stateStore) {
      throw new Error('State store is not available');
    }

    await this.stateStore.deleteTask(taskId);
    this.logger.log(`[${taskId}] Task data deleted`);
  }

  /**
   * 清理过期任务
   */
  async cleanupOldTasks(olderThanDays: number = 7): Promise<number> {
    if (!this.redis) {
      throw new Error('Redis client is not available');
    }

    const pattern = 'document:task:*:progress';
    const keys = this.redis.scanKeys
      ? await this.redis.scanKeys(pattern)
      : await this.redis.keys(pattern);
    let cleanedCount = 0;

    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          const progress = JSON.parse(data);
          const endTime = progress.endTime ? new Date(progress.endTime).getTime() : null;

          if (endTime && endTime < cutoffTime) {
            const taskId = key.slice('document:task:'.length, -':progress'.length);
            await this.deleteTask(taskId);
            cleanedCount++;
          }
        } catch (error) {
          this.logger.warn(`Failed to parse progress data for key ${key}, skipping`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    this.logger.log(`Cleaned up ${cleanedCount} old tasks (older than ${olderThanDays} days)`);
    return cleanedCount;
  }
}
