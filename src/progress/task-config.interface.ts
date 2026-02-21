/**
 * 文档任务配置
 */
export interface DocumentTaskConfig {
  /**
   * 只处理指定的页面（用于部分处理）
   */
  processOnlyPages?: number[];

  /**
   * 跳过指定的页面
   */
  skipPages?: number[];

  /**
   * OCR 提示词（用于扫描 PDF）
   */
  ocrPrompt?: string;

  /**
   * 最大重试次数
   */
  maxRetries?: number;

  /**
   * 每页最大字符数（用于分页）
   * 如果文档没有天然的页面概念，会按此大小分页
   */
  maxCharsPerPage?: number;
}
