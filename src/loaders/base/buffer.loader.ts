import { Logger } from '@nestjs/common';
import { readFile as ReadFileT } from 'fs/promises';
import { Document } from '../../models/document.model';
import { BaseDocumentLoader, LoaderOptions } from './base-loader';

/**
 * Buffer 加载器选项
 */
export interface BufferLoaderOptions extends LoaderOptions {
  /**
   * 文件编码
   * @default 'utf-8'
   */
  encoding?: BufferEncoding;

  /**
   * 是否自动检测编码
   * 如果为 true，将尝试自动检测文件编码
   * @default false
   */
  autodetectEncoding?: boolean;
}

/**
 * Buffer 加载器抽象基类
 *
 * 适用于简单的文本文件解析（Text, CSV, JSON, Markdown, HTML）
 * 提供统一的编码处理（encoding, autodetectEncoding）和文件读取逻辑
 * 子类只需实现 parse() 方法来解析 buffer
 *
 * 参考 LangChain Python 设计，统一处理文件路径和 Blob 的读取
 *
 * **使用场景**:
 * - ✅ 简单文本文件（只需 buffer.toString() 即可解析）
 * - ✅ 不需要复杂的分页逻辑
 * - ✅ 不需要可复用的解析器
 * - ✅ 需要统一的编码处理
 *
 * **不适用场景**:
 * - ❌ 需要复杂解析逻辑的文件格式（如 PDF, DOCX）
 * - ❌ 需要按页/按块分割的文档
 * - ❌ 解析器需要在多个 Loader 间复用
 *
 * 对于复杂文件格式，推荐使用 BlobLoader + BaseBlobParser 架构
 *
 * @see BlobLoader - 用于复杂文件格式（如 PDF）
 * @see BaseBlobParser - 可复用的解析器
 *
 * @example
 * ```typescript
 * // 简单文本加载器
 * class TextLoader extends BufferLoader {
 *   async parse(raw: Buffer, metadata: Document['metadata']): Promise<Document[]> {
 *     const text = raw.toString(this.encoding);
 *     return [new Document({ pageContent: text, metadata })];
 *   }
 * }
 *
 * // 使用编码检测
 * const loader = new TextLoader('file.txt', {
 *   autodetectEncoding: true
 * });
 * const docs = await loader.load();
 * ```
 */
export abstract class BufferLoader extends BaseDocumentLoader {
  protected static readonly logger = new Logger(BufferLoader.name);
  protected encoding: BufferEncoding;
  protected autodetectEncoding: boolean;

  constructor(
    public filePathOrBlob: string | Blob,
    options: BufferLoaderOptions = {}
  ) {
    super(options);
    this.encoding = options.encoding ?? 'utf-8';
    this.autodetectEncoding = options.autodetectEncoding ?? false;
  }

  /**
   * 解析 buffer 并返回文档数组
   * 子类需要实现此方法
   *
   * @param raw - 要解析的 buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  protected abstract parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]>;

  /**
   * 懒加载文档（实现基类方法）
   *
   * 读取文件或 Blob，然后调用 parse() 方法，逐个生成文档
   */
  async *lazyLoad(): AsyncGenerator<Document> {
    let buffer: Buffer;
    let metadata: Record<string, string>;

    if (typeof this.filePathOrBlob === 'string') {
      // 从文件路径读取
      const { readFile } = await BufferLoader.imports();
      buffer = await readFile(this.filePathOrBlob);
      metadata = { source: this.filePathOrBlob };
    } else {
      // 从 Blob 读取
      buffer = await this.filePathOrBlob
        .arrayBuffer()
        .then((ab) => Buffer.from(ab));
      metadata = { source: 'blob', blobType: this.filePathOrBlob.type };
    }

    // 自动检测编码
    if (this.autodetectEncoding) {
      const detectedEncoding = await this.detectEncoding(buffer);
      if (detectedEncoding) {
        // UTF-16 BE: Node.js 不原生支持，手动交换字节序转为 LE
        if ((detectedEncoding as string) === 'utf16be') {
          buffer = BufferLoader.swapBytes16(buffer);
          this.encoding = 'utf16le';
          metadata.detectedEncoding = 'utf16be (converted to utf16le)';
        } else {
          this.encoding = detectedEncoding;
          metadata.detectedEncoding = detectedEncoding;
        }
      }
    }

    const documents = await this.parse(buffer, metadata);

    // 逐个生成文档
    for (const doc of documents) {
      yield doc;
    }
  }

  /**
   * 检测 Buffer 的编码
   * 使用简单的启发式方法检测常见编码
   */
  private async detectEncoding(buffer: Buffer): Promise<BufferEncoding | null> {
    try {
      // 尝试使用 chardet 库（如果可用）
      const chardet = await this.tryImportChardet();
      if (chardet) {
        const detected = chardet.detect(buffer);
        if (detected) {
          return this.normalizeEncoding(detected);
        }
      }
    } catch (e) {
      // chardet 不可用，使用简单的启发式方法
    }

    // 简单的启发式检测
    // 检查 BOM (Byte Order Mark)
    if (buffer.length >= 3) {
      // UTF-8 BOM
      if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return 'utf-8';
      }
    }

    if (buffer.length >= 2) {
      // UTF-16 LE BOM
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return 'utf16le';
      }
      // UTF-16 BE BOM — Node.js 不原生支持 utf16be，
      // 需要手动交换字节序后按 utf16le 解码
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return 'utf16be' as BufferEncoding;
      }
    }

    // 尝试解码为 UTF-8，如果失败则可能是其他编码
    try {
      const text = buffer.toString('utf-8');
      // 检查是否包含替换字符（表示解码失败）
      if (!text.includes('\ufffd')) {
        return 'utf-8';
      }
    } catch (e) {
      // UTF-8 解码失败
    }

    // 默认返回 null，使用用户指定的编码
    return null;
  }

  /**
   * 交换 16-bit 字节序（UTF-16 BE → LE）
   */
  private static swapBytes16(buffer: Buffer): Buffer {
    const swapped = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length - 1; i += 2) {
      swapped[i] = buffer[i + 1];
      swapped[i + 1] = buffer[i];
    }
    return swapped;
  }

  /**
   * 尝试导入 chardet 库
   */
  private async tryImportChardet(): Promise<any> {
    try {
      const chardet = await import('chardet');
      return chardet;
    } catch (e) {
      return null;
    }
  }

  /**
   * 规范化编码名称
   */
  private normalizeEncoding(encoding: string): BufferEncoding {
    const normalized = encoding.toLowerCase().replace(/[-_]/g, '');

    const encodingMap: Record<string, BufferEncoding> = {
      utf8: 'utf-8',
      utf16le: 'utf16le',
      latin1: 'latin1',
      ascii: 'ascii',
      base64: 'base64',
      hex: 'hex',
    };

    return encodingMap[normalized] || 'utf-8';
  }

  /**
   * 动态导入 fs/promises 模块
   * 仅在 Node.js 环境中可用
   *
   * @returns Promise that resolves with readFile function
   */
  static async imports(): Promise<{
    readFile: typeof ReadFileT;
  }> {
    try {
      const { readFile } = await import('fs/promises');
      return { readFile };
    } catch (e) {
      BufferLoader.logger.error('Failed to load fs/promises', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load fs/promises. BufferLoader is only available in Node.js environment.'
      );
    }
  }
}
