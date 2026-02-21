/**
 * OCR 服务接口
 *
 * 定义 Document 模块所需的 OCR 服务契约，
 * 由外部模块（如 @nestai/ocr）实现
 */
export interface IOCRService {
  /**
   * 处理文档（OCR 识别）
   *
   * @param taskId - 任务标识
   * @param input - 输入数据（如 PDF Buffer）
   * @param options - 处理选项
   * @param callbacks - 页面级回调
   * @returns OCR 处理结果
   */
  processDocument(
    taskId: string,
    input: { pdfBuffer: Buffer },
    options?: {
      processOnlyPages?: number[];
      ocrPrompt?: string;
    },
    callbacks?: {
      onPageSuccess?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
      onPageFailed?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
    },
  ): Promise<IOCRResult>;

  /**
   * 获取页面处理结果（用于断点续传场景）
   *
   * @param taskId - 任务标识
   * @param pageIndices - 要获取的页码列表
   * @returns 页面结果数组
   */
  getPageResults?(
    taskId: string,
    pageIndices: number[],
  ): Promise<IOCRPageResult[]>;

  /**
   * 健康检查（可选）
   */
  healthCheck?(): Promise<void>;
}

/**
 * OCR 页面处理结果
 */
export interface IOCRPageResult {
  pageIndex: number;
  status: string;
  text?: string;
  duration?: number;
  timestamp?: number;
}

/**
 * OCR 处理结果
 */
export interface IOCRResult {
  totalPages: number;
  results: IOCRPageResult[];
  /** 所有成功页面的合并全文（按页码顺序拼接） */
  fullText?: string;
}
