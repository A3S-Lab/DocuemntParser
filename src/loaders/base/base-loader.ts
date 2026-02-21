import { Document } from '../../models/document.model';
import { DocumentLoadError } from '../../common/errors/document.errors';

/**
 * 加载器配置选项
 */
export interface LoaderOptions {
  /**
   * 最大重试次数
   * @default 3
   */
  maxRetries?: number;

  /**
   * 重试延迟（毫秒）
   * @default 1000
   */
  retryDelay?: number;

  /**
   * 是否使用指数退避
   * @default true
   */
  exponentialBackoff?: boolean;

  /**
   * 进度回调函数
   */
  onProgress?: (progress: LoaderProgress) => void;
}

/**
 * 加载器进度信息
 */
export interface LoaderProgress {
  /**
   * 当前处理的项目索引
   */
  current: number;

  /**
   * 总项目数（如果已知）
   */
  total?: number;

  /**
   * 进度百分比（0-100）
   */
  percentage?: number;

  /**
   * 当前状态描述
   */
  status: string;

  /**
   * 额外的元数据
   */
  metadata?: Record<string, any>;
}

/**
 * 文档加载器接口
 */
export interface DocumentLoader {
  /**
   * 加载文档
   */
  load(): Promise<Document[]>;

  /**
   * 懒加载文档（推荐使用）
   * 逐个生成文档，避免一次性加载到内存
   */
  lazyLoad(): AsyncGenerator<Document>;
}

/**
 * 文档加载器抽象基类
 *
 * 参考 LangChain Python 设计，提供懒加载和便捷方法
 * 支持错误处理、重试机制和进度回调
 *
 * @example
 * ```typescript
 * class MyLoader extends BaseDocumentLoader {
 *   async *lazyLoad(): AsyncGenerator<Document> {
 *     // 逐个生成文档
 *     yield new Document({ pageContent: 'doc1', metadata: {} });
 *     yield new Document({ pageContent: 'doc2', metadata: {} });
 *   }
 * }
 * ```
 */
export abstract class BaseDocumentLoader implements DocumentLoader {
  protected options: LoaderOptions;

  constructor(options: LoaderOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      exponentialBackoff: options.exponentialBackoff ?? true,
      onProgress: options.onProgress,
    };
  }

  /**
   * 懒加载文档（子类必须实现）
   *
   * 使用 Generator 模式逐个生成文档，避免一次性加载到内存
   * 适合处理大文件或大量文档
   *
   * @returns AsyncGenerator that yields Document objects
   *
   * @example
   * ```typescript
   * async *lazyLoad(): AsyncGenerator<Document> {
   *   for (const item of items) {
   *     yield new Document({
   *       pageContent: item.content,
   *       metadata: { source: item.source }
   *     });
   *   }
   * }
   * ```
   */
  abstract lazyLoad(): AsyncGenerator<Document>;

  /**
   * 加载所有文档（便捷方法）
   *
   * 支持自动重试和错误处理
   * 注意：对于大文件，推荐使用 lazyLoad() 以避免内存问题
   *
   * @returns Promise that resolves with an array of Document instances
   */
  async load(): Promise<Document[]> {
    return this.withRetry(async () => {
      const documents: Document[] = [];
      let current = 0;

      for await (const doc of this.lazyLoad()) {
        documents.push(doc);
        current++;

        // 触发进度回调
        if (this.options.onProgress) {
          this.options.onProgress({
            current,
            status: 'loading',
            metadata: { documentCount: documents.length }
          });
        }
      }

      // 完成回调
      if (this.options.onProgress) {
        this.options.onProgress({
          current,
          total: current,
          percentage: 100,
          status: 'completed',
          metadata: { documentCount: documents.length }
        });
      }

      return documents;
    });
  }

  /**
   * 加载并切分文档
   *
   * 便捷方法，自动组合文档加载和文本切分
   *
   * @param splitter 文本切分器，如果不提供则使用默认的 RecursiveCharacterTextSplitter
   * @returns Promise that resolves with an array of split Document chunks
   *
   * @example
   * ```typescript
   * const loader = new PDFLoader('doc.pdf');
   *
   * // 使用默认切分器
   * const chunks = await loader.loadAndSplit();
   *
   * // 使用自定义切分器
   * const customSplitter = new RecursiveCharacterTextSplitter({
   *   chunkSize: 500,
   *   chunkOverlap: 50
   * });
   * const chunks = await loader.loadAndSplit(customSplitter);
   * ```
   */
  async loadAndSplit(splitter?: any): Promise<Document[]> {
    // 动态导入以避免循环依赖
    if (!splitter) {
      const { RecursiveCharacterTextSplitter } = await import('../../splitters/recursive-character-text-splitter.js');
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200
      });
    }

    const docs = await this.load();
    return splitter.splitDocuments(docs);
  }

  /**
   * 带重试机制的执行函数
   *
   * @param fn 要执行的函数
   * @returns Promise that resolves with the function result
   */
  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    const maxRetries = this.options.maxRetries ?? 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // 最后一次尝试失败，直接抛出
        if (attempt === maxRetries - 1) {
          break;
        }

        // 计算延迟时间
        const delay = this.options.exponentialBackoff
          ? (this.options.retryDelay ?? 1000) * Math.pow(2, attempt)
          : (this.options.retryDelay ?? 1000);

        // 触发进度回调
        if (this.options.onProgress) {
          this.options.onProgress({
            current: attempt + 1,
            total: maxRetries,
            status: 'retrying',
            metadata: {
              attempt: attempt + 1,
              delay,
              error: lastError.message
            }
          });
        }

        // 等待后重试
        await this.delay(delay);
      }
    }

    // 所有重试都失败
    throw new DocumentLoadError(
      `Failed to load document after ${maxRetries} attempts`,
      lastError ?? undefined
    );
  }

  /**
   * 延迟函数
   *
   * @param ms 延迟毫秒数
   * @returns Promise that resolves after the delay
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
