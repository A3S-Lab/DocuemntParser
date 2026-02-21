import { Logger } from '@nestjs/common';
import { Document } from '../../models/document.model';
import { BaseBlobParser, Blob } from '../base/blob-parser';

/**
 * Markdown 转换器 Parser 配置选项
 */
export interface MarkdownConverterOptions {
  /**
   * 文件扩展名（用于 markitdown-ts 识别文件类型）
   * @example '.pdf', '.docx', '.doc', '.xlsx'
   */
  fileExtension: string;
}

/**
 * Markdown 转换器 Parser
 *
 * 使用 markitdown-ts 将各种文档格式转换为 Markdown
 * 保留文档结构（标题、列表、表格等）
 *
 * 支持的格式：
 * - PDF (.pdf)
 * - Word (.docx, .doc)
 * - Excel (.xlsx, .xls)
 * - 图片 (.jpg, .png) - 需要 LLM 支持
 * - 音频 (.mp3, .wav) - 需要转录服务
 *
 * @example
 * ```typescript
 * const parser = new MarkdownConverterParser({ fileExtension: '.pdf' });
 * const blob = { data: buffer, metadata: {} };
 * const docs = await parser.parse(blob);
 * // 返回: [Document(markdown格式的内容)]
 * ```
 */
export class MarkdownConverterParser extends BaseBlobParser {
  private static readonly logger = new Logger(MarkdownConverterParser.name);
  private static markitdownPromise: Promise<any> | null = null;
  private fileExtension: string;

  constructor(options: MarkdownConverterOptions) {
    super();
    this.fileExtension = options.fileExtension;
  }

  /**
   * 获取或创建 MarkItDown 单例（Promise 缓存防止并发竞态）
   */
  private static getMarkItDown(): Promise<any> {
    if (!MarkdownConverterParser.markitdownPromise) {
      MarkdownConverterParser.markitdownPromise = MarkdownConverterParser.imports()
        .then(({ MarkItDown }) => new MarkItDown())
        .catch((err) => {
          // 初始化失败时清除缓存，允许重试
          MarkdownConverterParser.markitdownPromise = null;
          throw err;
        });
    }
    return MarkdownConverterParser.markitdownPromise;
  }

  /**
   * 懒解析 Blob 并转换为 Markdown
   */
  async *lazyParse(blob: Blob): AsyncGenerator<Document> {
    const markitdown = await MarkdownConverterParser.getMarkItDown();

    try {
      // 使用 convertBuffer 方法处理 Buffer
      const result = await markitdown.convertBuffer(blob.data, {
        file_extension: this.fileExtension,
      });

      if (result?.markdown) {
        yield new Document({
          pageContent: result.markdown,
          metadata: {
            ...blob.metadata,
            format: 'markdown',
            originalFormat: this.fileExtension.replace('.', ''),
            convertedBy: 'markitdown-ts',
          },
        });
      }
    } catch (error) {
      MarkdownConverterParser.logger.error(`Failed to convert ${this.fileExtension} to markdown`, { error: error instanceof Error ? error.message : String(error) });
      throw new Error(
        `Markdown conversion failed for ${this.fileExtension}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * 动态导入 markitdown-ts 库
   */
  private static async imports() {
    try {
      const module = await import('markitdown-ts');
      return { MarkItDown: module.MarkItDown };
    } catch (e) {
      MarkdownConverterParser.logger.error('Failed to load markitdown-ts', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load markitdown-ts. Please install it with: npm install markitdown-ts'
      );
    }
  }
}
