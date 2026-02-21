/**
 * 任务状态常量
 */
export const TaskStatus = {
  /** 等待处理 */
  PENDING: 'pending',
  /** 处理中 */
  PROCESSING: 'processing',
  /** 已完成 */
  COMPLETED: 'completed',
  /** 失败 */
  FAILED: 'failed',
  /** 已取消 */
  CANCELLED: 'cancelled',
} as const;

/**
 * 任务状态类型
 */
export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];
