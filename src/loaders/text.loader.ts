import { Document } from '../models/document.model';
import { BufferLoader, BufferLoaderOptions } from './base/buffer.loader';

/**
 * Text 加载器配置选项
 */
export interface TextLoaderOptions extends BufferLoaderOptions {
  // 继承 BufferLoaderOptions 的所有选项（encoding, autodetectEncoding）
}

/**
 * Text 加载器 - 处理纯文本文件
 *
 * 参考 LangChain Python 设计
 * 返回完整的文本内容作为单个 Document
 * 支持编码检测和自定义编码
 *
 * @example
 * ```typescript
 * // 基础用法（UTF-8）
 * const loader = new TextLoader('document.txt');
 * const docs = await loader.load();
 * // 返回: [Document(完整文本内容)]
 *
 * // 指定编码
 * const loader = new TextLoader('document.txt', { encoding: 'latin1' });
 * const docs = await loader.load();
 *
 * // 自动检测编码
 * const loader = new TextLoader('document.txt', { autodetectEncoding: true });
 * const docs = await loader.load();
 * ```
 */
export class TextLoader extends BufferLoader {
  constructor(
    filePathOrBlob: string | Blob,
    options: TextLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
  }

  /**
   * 解析文本 buffer 并返回文档数组
   *
   * @param raw - 文本 buffer
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
          format: 'text',
          encoding: this.encoding,
        },
      }),
    ];
  }
}
