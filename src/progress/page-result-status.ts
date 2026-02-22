/**
 * 页面处理结果状态
 */
export const PageResultStatus = {
  /** 成功 */
  SUCCESS: 'success',
  /** 失败 */
  FAILED: 'failed',
  /** 跳过 */
  SKIPPED: 'skipped',
} as const;

/**
 * 页面处理结果状态类型
 */
export type PageResultStatus = typeof PageResultStatus[keyof typeof PageResultStatus];
