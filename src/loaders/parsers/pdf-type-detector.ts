import { Logger } from '@nestjs/common';

/**
 * PDF 类型检测工具
 */
export class PdfTypeDetector {
  private static readonly logger = new Logger(PdfTypeDetector.name);

  /**
   * 检测 PDF 是否为扫描版
   *
   * 综合多个指标判断：
   * 1. 文本密度：每页平均字符数
   * 2. 文本质量：是否包含大量乱码
   * 3. 可读内容比例
   */
  static async isScannedPdf(buffer: Buffer): Promise<boolean> {
    try {
      const { textStr, numPages } = await this.parsePdfText(buffer);
      return this.analyzeScanned(textStr, numPages);
    } catch (error) {
      PdfTypeDetector.logger.warn('Failed to detect PDF type', {
        error: error instanceof Error ? error.message : String(error),
      });
      // 检测失败时，默认认为是可编辑 PDF
      return false;
    }
  }

  /**
   * 计算特殊字符比例
   */
  private static calculateSpecialCharRatio(text: string): number {
    if (text.length === 0) return 0;

    const specialChars = text.match(/[^\w\s\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g);
    const specialCharCount = specialChars ? specialChars.length : 0;

    return specialCharCount / text.length;
  }

  /**
   * 获取 PDF 详细信息（用于调试）
   *
   * 复用 parsePdfText 避免重复解析
   */
  static async getPdfInfo(buffer: Buffer): Promise<{
    numPages: number;
    textLength: number;
    avgCharsPerPage: number;
    specialCharRatio: number;
    isScanned: boolean;
  }> {
    const { textStr, numPages } = await this.parsePdfText(buffer);

    const textLength = textStr.trim().length;
    const avgCharsPerPage = numPages > 0 ? textLength / numPages : 0;
    const specialCharRatio = this.calculateSpecialCharRatio(textStr);
    const isScanned = this.analyzeScanned(textStr, numPages);

    return {
      numPages,
      textLength,
      avgCharsPerPage,
      specialCharRatio,
      isScanned,
    };
  }

  /**
   * 解析 PDF 文本（内部公共方法，避免重复解析）
   */
  private static async parsePdfText(buffer: Buffer): Promise<{
    textStr: string;
    numPages: number;
  }> {
    const pdfParseModule = await import('pdf-parse');
    const PDFParse = (pdfParseModule as any).PDFParse;

    const parser = new PDFParse({ data: buffer, verbosity: 0 });
    try {
      await parser.load();

      const text = await parser.getText();
      const info = await parser.getInfo();
      const numPages = info.total || 1;

      return { textStr: String(text || ''), numPages };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  /**
   * 分析文本特征判断是否为扫描版（纯计算，无 I/O）
   */
  private static analyzeScanned(textStr: string, numPages: number): boolean {
    const textLength = textStr.trim().length;

    // 空文本直接判定为扫描版
    if (textLength === 0) {
      return true;
    }

    const avgCharsPerPage = textLength / numPages;

    // 1. 每页平均字符数少于 100
    if (avgCharsPerPage < 100) {
      return true;
    }

    // 2. 特殊字符比例超过 30%
    const specialCharRatio = this.calculateSpecialCharRatio(textStr);
    if (specialCharRatio > 0.3) {
      return true;
    }

    // 3. 可读内容比例低于 50%
    const readableText = textStr.replace(/[\s\n\r\t\u0000-\u001F\u007F-\u009F]/g, '');
    const readableRatio = readableText.length / textLength;
    if (readableRatio < 0.5) {
      return true;
    }

    // 4. 综合判断
    if (avgCharsPerPage < 200 && specialCharRatio > 0.2) {
      return true;
    }

    return false;
  }
}
