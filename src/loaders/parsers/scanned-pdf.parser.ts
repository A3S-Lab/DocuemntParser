import { Logger } from '@nestjs/common';
import { Document } from '../../models/document.model';
import { Blob, BaseBlobParser } from '../base/blob-parser';
import { IOCRService, IOCRPageResult } from '../../common/interfaces/ocr-service.interface';
import { PageResultStatus } from '../../progress/page-result-status';

/**
 * 扫描 PDF 解析器配置选项
 */
export interface ScannedPDFParserOptions {
  /**
   * OCR 服务实例（从 @nestai/ocr 模块注入）
   */
  ocrService?: IOCRService;

  /**
   * OCR 提示词（用于指导 OCR 识别）
   */
  ocrPrompt?: string;

  /**
   * 是否启用任务管理（断点续传、进度跟踪）
   */
  enableTaskManagement?: boolean;

  /**
   * 任务 ID（用于断点续传）
   */
  taskId?: string;

  /**
   * 页面处理回调
   */
  onPageSuccess?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
  onPageFailed?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
}

/**
 * 扫描 PDF 解析器
 *
 * 用于处理扫描版 PDF（图片型 PDF），通过 OCR 提取文本。
 * 每页独立输出一个 Document，metadata 中包含 pageNumber 和 totalPages。
 *
 * 如果需要对多页文本做滑动窗口合并（用于后续语义切分），
 * 请在 pipeline 中使用 PageMergeProcessor。
 *
 * 特性：
 * - 集成 OCR 模块进行文本识别
 * - 每页独立 Document，适合按页存库
 * - 支持任务管理和断点续传
 * - 支持进度跟踪和页面级回调
 *
 * @example
 * ```typescript
 * const parser = new ScannedPDFParser({
 *   ocrService,
 *   ocrPrompt: '请识别图片中的文字',
 * });
 *
 * // 后续 pipeline 中合并 + 切分：
 * // PageMergeProcessor → RecursiveCharacterSplitter → EmbeddingProcessor
 * ```
 */
export class ScannedPDFParser extends BaseBlobParser {
  private static readonly logger = new Logger(ScannedPDFParser.name);

  constructor(private readonly options: ScannedPDFParserOptions = {}) {
    super();
  }

  /**
   * 懒解析扫描 PDF
   *
   * 使用 OCR 服务逐页识别文本，每页输出一个 Document
   */
  async *lazyParse(blob: Blob): AsyncGenerator<Document> {
    if (!this.options.ocrService) {
      throw new Error(
        'OCR service is required for scanned PDF parsing. ' +
        'Please inject OcrService from @nestai/ocr module.',
      );
    }

    const taskId = this.options.taskId || `scanned-pdf-${Date.now()}`;

    try {
      // 使用 OCR 服务处理 PDF
      const result = await this.options.ocrService.processDocument(
        taskId,
        { pdfBuffer: blob.data },
        { ocrPrompt: this.options.ocrPrompt },
        {
          onPageSuccess: this.options.onPageSuccess,
          onPageFailed: this.options.onPageFailed,
        },
      );

      // 收集成功的页面结果
      let pageTexts: Array<{ pageIndex: number; text: string }>;

      if (this.options.enableTaskManagement && this.options.ocrService.getPageResults) {
        const pageResults = await this.options.ocrService.getPageResults(
          taskId,
          Array.from({ length: result.totalPages }, (_, i) => i + 1),
        );
        pageTexts = pageResults
          .filter(r => r && r.status === PageResultStatus.SUCCESS && r.text)
          .map(r => ({ pageIndex: r.pageIndex, text: r.text! }));
      } else {
        pageTexts = result.results
          .filter(r => r.status === PageResultStatus.SUCCESS && r.text)
          .map(r => ({ pageIndex: r.pageIndex, text: r.text! }));
      }

      // 按页码排序
      pageTexts.sort((a, b) => a.pageIndex - b.pageIndex);

      if (pageTexts.length === 0) {
        ScannedPDFParser.logger.warn(`[${taskId}] OCR 未产生任何有效文本`);
        return;
      }

      // 每页独立输出一个 Document
      for (const { pageIndex, text } of pageTexts) {
        yield new Document({
          pageContent: text,
          metadata: {
            ...blob.metadata,
            source: blob.metadata?.source || 'scanned-pdf',
            format: 'scanned-pdf',
            pageNumber: pageIndex,
            totalPages: result.totalPages,
            taskId,
          },
        });
      }
    } catch (error) {
      ScannedPDFParser.logger.error('Scanned PDF parsing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to parse scanned PDF: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * 检查 PDF 是否为扫描版
   */
  static async isScannedPDF(buffer: Buffer): Promise<boolean> {
    const { PdfTypeDetector } = await import('./pdf-type-detector.js');
    return await PdfTypeDetector.isScannedPdf(buffer);
  }
}
