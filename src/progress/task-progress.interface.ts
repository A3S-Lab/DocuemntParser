import { TaskStatus } from './task-status';
import { PageResultStatus } from './page-result-status';

/**
 * 文档处理进度信息
 */
export interface DocumentTaskProgress {
  /**
   * 总页数
   */
  total: number;

  /**
   * 已完成页数
   */
  completed: number;

  /**
   * 失败页数
   */
  failed: number;

  /**
   * 进度百分比 (0-100)
   */
  percentage: number;

  /**
   * 当前状态
   */
  status: TaskStatus;

  /**
   * 进度消息
   */
  message?: string;

  /**
   * 开始时间
   */
  startTime?: Date;

  /**
   * 结束时间
   */
  endTime?: Date;

  /**
   * 耗时（毫秒）
   */
  duration?: number;
}

/**
 * 单页处理结果
 */
export interface PageProcessResult {
  /**
   * 页码（1-based）
   */
  pageIndex: number;

  /**
   * 处理状态
   */
  status: PageResultStatus;

  /**
   * 提取的文本（success 时）
   */
  text?: string;

  /**
   * 错误信息（failed 时）
   */
  error?: Error;

  /**
   * 处理耗时（毫秒）
   */
  duration: number;

  /**
   * 时间戳
   */
  timestamp: Date;
}

/**
 * 文档处理任务结果
 */
export interface DocumentTaskResult {
  /**
   * 任务 ID
   */
  taskId: string;

  /**
   * 总页数
   */
  totalPages: number;

  /**
   * 已完成的页面数量
   */
  completedPages: number;

  /**
   * 失败的页面数量
   */
  failedPages: number;

  /**
   * 所有页面的处理结果
   */
  results: PageProcessResult[];
}

/**
 * 页面处理回调接口
 */
export interface IPageProcessCallback {
  /**
   * 页面处理成功回调
   * @param taskId 任务 ID
   * @param result 页面处理结果
   * @returns 如果返回 false，则停止后续页面的处理
   */
  onPageSuccess?(taskId: string, result: PageProcessResult): void | Promise<void | boolean>;

  /**
   * 页面处理失败回调
   * @param taskId 任务 ID
   * @param result 页面处理结果（包含错误信息）
   * @returns 如果返回 false，则停止后续页面的处理
   */
  onPageFailed?(taskId: string, result: PageProcessResult): void | Promise<void | boolean>;
}
