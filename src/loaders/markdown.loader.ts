import { Document } from '../models/document.model';
import { BufferLoader, BufferLoaderOptions } from './base/buffer.loader';

/**
 * Markdown 加载器配置选项
 */
export interface MarkdownLoaderOptions extends BufferLoaderOptions {
  // 继承 BufferLoaderOptions 的所有选项（encoding, autodetectEncoding）
}

/**
 * Markdown 加载器 - 处理 Markdown 文件
 *
 * 参考 LangChain Python 设计
 * 返回完整的 Markdown 内容作为单个 Document
 * 支持编码检测和自定义编码
 *
 * @example
 * ```typescript
 * const loader = new MarkdownLoader('README.md');
 * const docs = await loader.load();
 * // 返回: [Document(完整 Markdown 内容)]
 * ```
 */
export class MarkdownLoader extends BufferLoader {
  constructor(
    filePathOrBlob: string | Blob,
    options: MarkdownLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
  }

  /**
   * 解析 Markdown buffer 并返回文档数组
   *
   * @param raw - Markdown buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const text = raw.toString(this.encoding);

    return [
      new Document({
        pageContent: text,
        metadata: {
          ...metadata,
          format: 'markdown',
          encoding: this.encoding,
        },
      }),
    ];
  }
}
