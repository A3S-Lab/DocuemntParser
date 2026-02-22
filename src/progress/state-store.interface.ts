import { DocumentTaskProgress, PageProcessResult } from './task-progress.interface';

/**
 * 文档任务状态存储接口
 * 用于在分布式环境中持久化任务状态
 */
export interface IDocumentStateStore {
  /**
   * 保存页面结果
   */
  savePageResult(taskId: string, result: PageProcessResult): Promise<void>;

  /**
   * 获取页面结果
   */
  getPageResult(taskId: string, pageIndex: number): Promise<PageProcessResult | null>;

  /**
   * 获取所有结果
   */
  getAllResults(taskId: string): Promise<PageProcessResult[]>;

  /**
   * 获取已成功处理的页码列表
   */
  getProcessedPages(taskId: string): Promise<number[]>;

  /**
   * 获取失败的页码列表
   */
  getFailedPages(taskId: string): Promise<number[]>;

  /**
   * 更新任务进度
   */
  updateProgress(taskId: string, progress: DocumentTaskProgress): Promise<void>;

  /**
   * 获取任务进度
   */
  getProgress(taskId: string): Promise<DocumentTaskProgress | null>;

  /**
   * 获取或初始化任务进度
   */
  getOrCreateProgress(taskId: string, total: number): Promise<DocumentTaskProgress>;

  /**
   * 原子性地更新文档进度
   */
  updateDocumentProgress(taskId: string): Promise<{
    completed: number;
    failed: number;
    percentage: number;
    isCompleted: boolean;
  } | null>;

  /**
   * 标记页面为已处理
   */
  markPageAsProcessed(taskId: string, pageNumber: number): Promise<void>;

  /**
   * 标记页面为失败
   */
  markPageAsFailed(taskId: string, pageNumber: number): Promise<void>;

  /**
   * 取消任务
   */
  cancelTask(taskId: string): Promise<boolean>;

  /**
   * 删除任务所有数据（清理）
   */
  deleteTask(taskId: string): Promise<void>;
}
