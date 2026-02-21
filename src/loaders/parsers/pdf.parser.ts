import { Logger } from '@nestjs/common';
import { Document } from '../../models/document.model';
import { Blob, BaseBlobParser } from '../base/blob-parser';
import { MarkdownConverterParser } from './markdown-converter.parser';
import { ScannedPDFParser, ScannedPDFParserOptions } from './scanned-pdf.parser';

/**
 * PDF 解析器配置选项
 */
export interface PDFParserOptions {
  /**
   * 是否自动检测扫描 PDF
   * 默认: true
   */
  autoDetectScanned?: boolean;

  /**
   * 扫描 PDF 解析选项
   */
  scannedPdfOptions?: ScannedPDFParserOptions;
}

/**
 * PDF Blob 解析器
 *
 * 负责将 PDF Blob 数据解析为 Document 对象
 *
 * 智能解析策略：
 * 1. 检测是否为扫描 PDF
 *    - 如果是扫描 PDF -> 使用 OCR 识别
 *    - 如果是可编辑 PDF -> 继续下面的策略
 * 2. 可编辑 PDF 自动降级策略：
 *    - 优先: markitdown-ts 转换为 Markdown（保留文档结构）
 *    - 降级: pdf-parse 提取纯文本
 *
 * 主要依赖: npm install markitdown-ts
 * 降级依赖: npm install pdf-parse
 * OCR 依赖: @nestai/ocr 模块
 */
export class PDFParser extends BaseBlobParser {
  private static readonly logger = new Logger(PDFParser.name);

  constructor(private readonly options: PDFParserOptions = {}) {
    super();
  }

  /**
   * 懒解析 PDF Blob
   *
   * 智能检测 PDF 类型并选择合适的解析策略
   */
  async *lazyParse(blob: Blob): AsyncGenerator<Document> {
    const autoDetect = this.options.autoDetectScanned ?? true;

    // 如果启用自动检测且配置了 OCR 服务
    if (autoDetect && this.options.scannedPdfOptions?.ocrService) {
      const isScanned = await ScannedPDFParser.isScannedPDF(blob.data);

      if (isScanned) {
        PDFParser.logger.log('Detected scanned PDF, using OCR parser');
        yield* this.parseScannedPDF(blob);
        return;
      }
    }

    // 可编辑 PDF：使用原有的解析策略
    try {
      // 优先使用 markitdown-ts 转换为 Markdown
      yield* this.parseWithMarkdown(blob);
    } catch (markdownError) {
      PDFParser.logger.warn('Markdown conversion failed for PDF, falling back to text extraction', {
        error: markdownError instanceof Error ? markdownError.message : String(markdownError),
      });
      // 降级到纯文本提取
      yield* this.parsePlainText(blob);
    }
  }

  /**
   * 使用 OCR 解析扫描 PDF
   */
  private async *parseScannedPDF(blob: Blob): AsyncGenerator<Document> {
    const scannedParser = new ScannedPDFParser(this.options.scannedPdfOptions);
    yield* scannedParser.lazyParse(blob);
  }

  /**
   * 使用 markitdown-ts 转换为 Markdown
   */
  private async *parseWithMarkdown(blob: Blob): AsyncGenerator<Document> {
    const markdownParser = new MarkdownConverterParser({
      fileExtension: '.pdf'
    });
    yield* markdownParser.lazyParse(blob);
  }

  /**
   * 使用 pdf-parse 提取纯文本（备选方案）
   */
  private async *parsePlainText(blob: Blob): AsyncGenerator<Document> {
    const PDFParse = await PDFParser.importsPDF();

    const parser = new PDFParse({
      data: blob.data,
      verbosity: 0  // 0 = ERRORS only
    });

    try {
      await parser.load();

      const info = await parser.getInfo();
      const numPages = info.total || 1;

      const fullText = await parser.getText();
      yield new Document({
        pageContent: fullText,
        metadata: {
          ...blob.metadata,
          format: 'text',
          pdf: {
            version: info.info?.PDFFormatVersion,
            info: info.info,
            totalPages: numPages,
          },
        },
      });
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  /**
   * 动态导入 pdf-parse 库 (v2.x)
   */
  static async importsPDF() {
    try {
      // pdf-parse v2 使用命名导出 PDFParse
      const pdfParseModule = await import('pdf-parse');
      return (pdfParseModule as any).PDFParse;
    } catch (e) {
      PDFParser.logger.error('Failed to load pdf-parse', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load pdf-parse. Please install it with: npm install pdf-parse'
      );
    }
  }
}
