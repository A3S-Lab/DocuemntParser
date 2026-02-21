import { BaseBlobParser } from './base/blob-parser';
import { LoaderOptions } from './base/base-loader';
import { FileBlobLoader } from './base/blob.loader';
import { PDFParser, PDFParserOptions } from './parsers/pdf.parser';

/**
 * PDF 加载器配置选项
 */
export interface PDFLoaderOptions extends LoaderOptions, PDFParserOptions {}

/**
 * PDF 加载器 - 处理 PDF 文件
 *
 * 使用新的 BlobLoader 架构，分离加载和解析逻辑
 * 需要安装依赖: npm install pdf-parse
 *
 * @example
 * ```typescript
 * // 按页分割
 * const loader = new PDFLoader('document.pdf');
 * const docs = await loader.load();
 * // 返回: [Document(page1), Document(page2), ...]
 *
 * // 完整文档
 * const loader = new PDFLoader('document.pdf', { splitPages: false });
 * const docs = await loader.load();
 * // 返回: [Document(all pages)]
 *
 * // 使用懒加载
 * for await (const doc of loader.lazyLoad()) {
 *   console.log(doc.pageContent);
 * }
 *
 * // 带进度回调
 * const loader = new PDFLoader('document.pdf', {
 *   onProgress: (progress) => {
 *     console.log(`Progress: ${progress.percentage}%`);
 *   }
 * });
 * const docs = await loader.load();
 * ```
 */
export class PDFLoader extends FileBlobLoader {
  private parser: PDFParser;

  constructor(
    filePathOrBlob: string | globalThis.Blob,
    options: PDFLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.parser = new PDFParser(options);
  }

  /**
   * 获取 PDF 解析器
   */
  protected getParser(): BaseBlobParser {
    return this.parser;
  }
}

// 导出配置选项类型
export type { PDFParserOptions } from './parsers/pdf.parser';
