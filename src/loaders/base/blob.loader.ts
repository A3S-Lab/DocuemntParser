import { Logger } from '@nestjs/common';
import { readFile as ReadFileT } from 'fs/promises';
import { Document } from '../../models/document.model';
import { BaseDocumentLoader, LoaderOptions } from './base-loader';
import { Blob, BaseBlobParser } from './blob-parser';

/**
 * Blob 加载器抽象基类
 *
 * 负责从不同来源加载 Blob 数据
 * 分离了数据加载和解析的关注点
 *
 * @example
 * ```typescript
 * class MyBlobLoader extends BlobLoader {
 *   constructor(private filePath: string) {
 *     super();
 *   }
 *
 *   async loadBlob(): Promise<Blob> {
 *     const buffer = await readFile(this.filePath);
 *     return {
 *       data: buffer,
 *       metadata: { source: this.filePath }
 *     };
 *   }
 * }
 * ```
 */
export abstract class BlobLoader extends BaseDocumentLoader {
  constructor(options: LoaderOptions = {}) {
    super(options);
  }

  /**
   * 加载 Blob 数据（子类必须实现）
   *
   * @returns Promise that resolves with Blob data
   */
  abstract loadBlob(): Promise<Blob>;

  /**
   * 懒加载文档（实现基类方法）
   *
   * 加载 Blob 并使用解析器逐个生成文档
   */
  async *lazyLoad(): AsyncGenerator<Document> {
    const blob = await this.loadBlob();
    const parser = this.getParser();

    for await (const doc of parser.lazyParse(blob)) {
      yield doc;
    }
  }

  /**
   * 获取 Blob 解析器（子类可以重写）
   *
   * @returns BaseBlobParser instance
   */
  protected abstract getParser(): BaseBlobParser;

  /**
   * 加载并解析 Blob（便捷方法）
   *
   * @param parser - 可选的自定义解析器
   * @returns Promise that resolves with an array of Document instances
   */
  async loadAndParse(parser?: BaseBlobParser): Promise<Document[]> {
    const blob = await this.loadBlob();
    const blobParser = parser ?? this.getParser();
    return blobParser.parse(blob);
  }
}

/**
 * 文件 Blob 加载器
 *
 * 从文件系统或 Web Blob 对象加载数据
 */
export abstract class FileBlobLoader extends BlobLoader {
  protected static readonly logger = new Logger(FileBlobLoader.name);

  constructor(
    public filePathOrBlob: string | globalThis.Blob,
    options: LoaderOptions = {}
  ) {
    super(options);
  }

  /**
   * 加载 Blob 数据
   */
  async loadBlob(): Promise<Blob> {
    if (typeof this.filePathOrBlob === 'string') {
      // 从文件路径读取
      const { readFile } = await FileBlobLoader.imports();
      const buffer = await readFile(this.filePathOrBlob);
      return {
        data: buffer,
        metadata: { source: this.filePathOrBlob }
      };
    } else {
      // 从 Web Blob 读取
      const buffer = await this.filePathOrBlob
        .arrayBuffer()
        .then((ab) => Buffer.from(ab));
      return {
        data: buffer,
        metadata: { source: 'blob', blobType: this.filePathOrBlob.type }
      };
    }
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
      FileBlobLoader.logger.error('Failed to load fs/promises', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load fs/promises. FileBlobLoader is only available in Node.js environment.'
      );
    }
  }
}
