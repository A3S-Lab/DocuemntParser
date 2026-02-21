import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { BufferLoader } from './base/buffer.loader';
import { LoaderOptions } from './base/base-loader';
import { MarkdownConverterParser } from './parsers/markdown-converter.parser';
import { Blob as BlobData } from './base/blob-parser';

/**
 * DOCX 加载器配置选项
 */
export interface DocxLoaderOptions extends LoaderOptions {
  /**
   * 文档类型
   */
  type?: 'docx' | 'doc';
}

/**
 * DOCX/DOC 加载器 - 处理 Word 文档
 *
 * 自动降级策略：
 * - DOCX: markitdown-ts → mammoth
 * - DOC: markitdown-ts → word-extractor
 *
 * 主要依赖: npm install markitdown-ts
 * 降级依赖 (可选):
 * - DOCX: npm install mammoth
 * - DOC: npm install word-extractor
 *
 * @example
 * ```typescript
 * // 加载 DOCX（自动尝试 Markdown，失败则降级到纯文本）
 * const loader = new DocxLoader('document.docx');
 * const docs = await loader.load();
 * // 返回: [Document(markdown格式)] 或 [Document(纯文本)]
 *
 * // 加载 DOC
 * const loader = new DocxLoader('document.doc', { type: 'doc' });
 * const docs = await loader.load();
 * ```
 */
export class DocxLoader extends BufferLoader {
  protected static readonly logger = new Logger(DocxLoader.name);
  private docType: 'docx' | 'doc';

  constructor(
    filePathOrBlob: string | Blob,
    options: DocxLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.docType = options.type ?? 'docx';
  }

  /**
   * 解析 Word buffer 并返回文档数组
   *
   * 优先尝试 Markdown 转换，失败则自动降级
   *
   * @param raw - Word buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    // 优先尝试 markitdown-ts 转换为 Markdown
    try {
      return await this.parseWithMarkdown(raw, metadata);
    } catch (markdownError) {
      DocxLoader.logger.warn(`Markdown conversion failed for ${this.docType}, falling back to text extraction`, {
        error: markdownError instanceof Error ? markdownError.message : String(markdownError),
      });

      // 降级到纯文本提取
      return await this.parseWithFallback(raw, metadata);
    }
  }

  /**
   * 使用 markitdown-ts 转换为 Markdown
   */
  private async parseWithMarkdown(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const fileExtension = this.docType === 'doc' ? '.doc' : '.docx';
    const markdownParser = new MarkdownConverterParser({ fileExtension });

    // 将 Buffer 转换为 BlobData 格式
    const blobData: BlobData = {
      data: raw,
      metadata,
      mimetype: this.docType === 'doc'
        ? 'application/msword'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    return markdownParser.parse(blobData);
  }

  /**
   * 降级方案：根据文件类型使用不同的文本提取库
   */
  private async parseWithFallback(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    if (this.docType === 'docx') {
      return this.parseDocxWithMammoth(raw, metadata);
    } else {
      return this.parseDocWithWordExtractor(raw, metadata);
    }
  }

  /**
   * 使用 mammoth 提取 DOCX 纯文本
   */
  private async parseDocxWithMammoth(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const { extractRawText } = await DocxLoader.importsDocx();
    const docx = await extractRawText({ buffer: raw });

    if (!docx.value) {
      return [];
    }

    return [
      new Document({
        pageContent: docx.value,
        metadata: {
          ...metadata,
          format: 'text',
          originalFormat: 'docx',
          extractedBy: 'mammoth',
        },
      }),
    ];
  }

  /**
   * 使用 word-extractor 提取 DOC 纯文本
   */
  private async parseDocWithWordExtractor(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const WordExtractor = await DocxLoader.importsDoc();
    const extractor = new WordExtractor();
    const doc = await extractor.extract(raw);

    return [
      new Document({
        pageContent: doc.getBody(),
        metadata: {
          ...metadata,
          format: 'text',
          originalFormat: 'doc',
          extractedBy: 'word-extractor',
        },
      }),
    ];
  }

  /**
   * 动态导入 mammoth 库
   */
  private static async importsDocx() {
    try {
      const { extractRawText } = await import('mammoth');
      return { extractRawText };
    } catch (e) {
      DocxLoader.logger.error('Failed to load mammoth', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load mammoth. Please install it with: npm install mammoth'
      );
    }
  }

  /**
   * 动态导入 word-extractor 库
   */
  private static async importsDoc() {
    try {
      const module = await import('word-extractor');
      // ESM: module.default 是构造函数; CJS (Jest ts-jest): module 本身是构造函数
      return (module as any).default ?? module;
    } catch (e) {
      DocxLoader.logger.error('Failed to load word-extractor', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load word-extractor. Please install it with: npm install word-extractor'
      );
    }
  }
}
