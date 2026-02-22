import { glob } from 'glob';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { BaseDocumentLoader, LoaderOptions } from './base/base-loader';
import { CSVLoader } from './csv.loader';
import { DocxLoader } from './docx.loader';
import { HTMLLoader } from './html.loader';
import { JSONLoader } from './json.loader';
import { MarkdownLoader } from './markdown.loader';
import { Document } from '../models/document.model';
import { PDFLoader } from './pdf.loader';
import { TextLoader } from './text.loader';
import { XLSXLoader } from './xlsx.loader';

/**
 * DirectoryLoader 配置选项
 */
export interface DirectoryLoaderOptions extends LoaderOptions {
  /**
   * Glob 模式
   * @default '**\/*'
   * @example '**\/*.{pdf,txt,md}'
   */
  glob?: string;

  /**
   * 是否递归加载子目录
   * @default true
   */
  recursive?: boolean;

  /**
   * 文件扩展名到加载器的映射
   *
   * 如果不提供，将使用默认映射
   *
   * @example
   * ```typescript
   * {
   *   '.custom': CustomLoader,
   *   '.txt': MyTextLoader
   * }
   * ```
   */
  loaderMap?: Record<string, new (path: string, options?: any) => BaseDocumentLoader>;

  /**
   * 是否显示加载进度
   * @default false
   */
  showProgress?: boolean;

  /**
   * 最大并发加载数
   * @default 4
   */
  maxConcurrency?: number;

  /**
   * 是否忽略加载错误
   * @default false
   */
  ignoreErrors?: boolean;

  /**
   * 排除的文件模式
   * @example ['**\/node_modules/**', '**\/.git/**']
   */
  exclude?: string[];
}

/**
 * DirectoryLoader
 *
 * 批量加载目录中的文档
 *
 * 特性：
 * - 自动根据文件扩展名选择合适的加载器
 * - 支持 Glob 模式过滤文件
 * - 支持并发加载
 * - 支持进度显示
 *
 * @example
 * ```typescript
 * // 加载目录中的所有文档
 * const loader = new DirectoryLoader('./docs');
 * const docs = await loader.load();
 *
 * // 只加载特定类型的文件
 * const loader = new DirectoryLoader('./docs', {
 *   glob: '**\/*.{pdf,txt,md}',
 *   recursive: true
 * });
 *
 * // 自定义加载器映射
 * const loader = new DirectoryLoader('./docs', {
 *   loaderMap: {
 *     '.custom': CustomLoader
 *   }
 * });
 * ```
 */
export class DirectoryLoader extends BaseDocumentLoader {
  private static readonly logger = new Logger(DirectoryLoader.name);
  private readonly dirPath: string;
  private readonly dirOptions: DirectoryLoaderOptions;

  constructor(dirPath: string, options: DirectoryLoaderOptions = {}) {
    super(options);
    this.dirPath = dirPath;
    this.dirOptions = {
      glob: '**/*',
      recursive: true,
      maxConcurrency: 4,
      ignoreErrors: false,
      showProgress: false,
      ...options,
    };
  }

  /**
   * 懒加载文档
   */
  async *lazyLoad(): AsyncGenerator<Document> {
    const files = await this.findFiles();

    if (this.dirOptions.showProgress) {
      DirectoryLoader.logger.log(`Found ${files.length} files to load`);
    }

    // 逐个文件加载并 yield，真正的懒加载
    let loaded = 0;
    for (const file of files) {
      try {
        const loader = this.getLoaderForFile(file);
        for await (const doc of loader.lazyLoad()) {
          yield doc;
        }
      } catch (error) {
        if (!this.dirOptions.ignoreErrors) {
          throw error;
        }
        DirectoryLoader.logger.error(`Error loading file ${file}`, { error: error instanceof Error ? error.message : String(error) });
      }

      loaded++;
      if (this.dirOptions.showProgress) {
        DirectoryLoader.logger.log(`Loaded ${loaded}/${files.length}: ${file}`);
      }
    }
  }

  /**
   * 查找匹配的文件
   */
  private async findFiles(): Promise<string[]> {
    const pattern = this.dirOptions.recursive
      ? this.dirOptions.glob!
      : this.dirOptions.glob!.replace('**/', '');

    const fullPattern = path.join(this.dirPath, pattern);

    const files = await glob(fullPattern, {
      ignore: this.dirOptions.exclude || ['**/node_modules/**', '**/.git/**'],
      nodir: true,
      absolute: true,
    });

    return files;
  }

  /**
   * 根据文件扩展名获取合适的加载器
   */
  private getLoaderForFile(filePath: string): BaseDocumentLoader {
    const ext = path.extname(filePath).toLowerCase();

    // 优先使用自定义映射
    const LoaderClass = this.dirOptions.loaderMap?.[ext];
    if (LoaderClass) {
      return new LoaderClass(filePath);
    }

    // 使用默认映射
    switch (ext) {
      case '.pdf':
        return new PDFLoader(filePath);
      case '.csv':
        return new CSVLoader(filePath);
      case '.json':
        return new JSONLoader(filePath);
      case '.md':
      case '.markdown':
        return new MarkdownLoader(filePath);
      case '.html':
      case '.htm':
        return new HTMLLoader(filePath);
      case '.xlsx':
      case '.xls':
        return new XLSXLoader(filePath);
      case '.docx':
        return new DocxLoader(filePath);
      case '.doc':
        return new DocxLoader(filePath, { type: 'doc' });
      case '.txt':
      case '.text':
        return new TextLoader(filePath);
      default:
        // 默认使用 TextLoader
        return new TextLoader(filePath);
    }
  }
}
