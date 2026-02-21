import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';

/**
 * 页面合并处理器配置
 */
export interface PageMergeProcessorOptions {
  /**
   * 滑动窗口大小（页数）
   *
   * 每个窗口合并多少个 Document 的文本为一个新 Document。
   * 值越大，每个输出 Document 的文本越长，语义越完整，
   * 但内存占用也越大。
   *
   * @default 10
   */
  windowSize?: number;

  /**
   * 窗口重叠数量
   *
   * 相邻窗口之间重叠的 Document 数量，用于避免跨页内容被截断。
   * 例如 windowSize=10, windowOverlap=2 时：
   *   窗口1: doc[0-9], 窗口2: doc[8-17], 窗口3: doc[16-25] ...
   *
   * @default 2
   */
  windowOverlap?: number;

  /**
   * 是否按页码排序
   *
   * 如果为 true，会先按 metadata 中的 pageNumber 字段排序再合并。
   * 适用于从数据库读取的乱序页面。
   *
   * @default true
   */
  sortByPage?: boolean;

  /**
   * metadata 中页码字段名
   *
   * @default 'pageNumber'
   */
  pageNumberKey?: string;

  /**
   * 页面文本之间的分隔符
   *
   * @default '\n\n'
   */
  separator?: string;
}

/**
 * 页面合并处理器
 *
 * 将多个按页独立的 Document 通过滑动窗口合并为更大的文本块，
 * 使后续的语义切分器（如 RecursiveCharacterSplitter、MarkdownHeaderSplitter）
 * 能够在语义连贯的文本上工作。
 *
 * 典型使用场景：扫描 PDF 经 OCR 按页识别后，从数据库读取成功的页面文本，
 * 通过此处理器合并后再做语义切分和 embedding。
 *
 * 数据流：
 * ```
 * 数据库读取页面文本 → Document[] (每页一个)
 *   → PageMergeProcessor (滑动窗口合并)
 *   → RecursiveCharacterSplitter (语义切分)
 *   → EmbeddingProcessor (向量化)
 * ```
 *
 * @example
 * ```typescript
 * // 从数据库读取的页面 Document
 * const pageDocs = [
 *   new Document({ pageContent: '第1页内容...', metadata: { pageNumber: 1 } }),
 *   new Document({ pageContent: '第2页内容...', metadata: { pageNumber: 2 } }),
 *   // ... 更多页
 * ];
 *
 * const processor = new PageMergeProcessor({
 *   windowSize: 10,
 *   windowOverlap: 2,
 * });
 *
 * const merged = await processor.process(pageDocs);
 * // merged: 滑动窗口合并后的 Document[]
 * ```
 */
export class PageMergeProcessor implements IDocumentProcessor {
  private readonly logger = new Logger(PageMergeProcessor.name);
  private readonly windowSize: number;
  private readonly windowOverlap: number;
  private readonly sortByPage: boolean;
  private readonly pageNumberKey: string;
  private readonly separator: string;

  constructor(options: PageMergeProcessorOptions = {}) {
    this.windowSize = options.windowSize ?? 10;
    this.windowOverlap = options.windowOverlap ?? 2;
    this.sortByPage = options.sortByPage ?? true;
    this.pageNumberKey = options.pageNumberKey ?? 'pageNumber';
    this.separator = options.separator ?? '\n\n';

    if (this.windowOverlap >= this.windowSize) {
      throw new Error(
        `windowOverlap (${this.windowOverlap}) 必须小于 windowSize (${this.windowSize})`,
      );
    }
  }

  getName(): string {
    return 'PageMergeProcessor';
  }

  getDescription(): string {
    return `滑动窗口合并页面文本（windowSize=${this.windowSize}, overlap=${this.windowOverlap}）`;
  }

  async process(documents: Document[]): Promise<Document[]> {
    if (documents.length === 0) return [];

    // 如果文档数量不超过窗口大小，直接合并为一个
    let sorted = [...documents];

    // 按页码排序
    if (this.sortByPage) {
      sorted.sort((a, b) => {
        const pageA = a.metadata?.[this.pageNumberKey] ?? 0;
        const pageB = b.metadata?.[this.pageNumberKey] ?? 0;
        return pageA - pageB;
      });
    }

    const step = Math.max(1, this.windowSize - this.windowOverlap);
    const results: Document[] = [];
    let windowIndex = 0;

    for (let i = 0; i < sorted.length; i += step) {
      const windowDocs = sorted.slice(i, i + this.windowSize);

      if (windowDocs.length === 0) break;

      const mergedText = windowDocs.map(d => d.pageContent).join(this.separator);

      // 收集页码范围
      const pageNumbers = windowDocs
        .map(d => d.metadata?.[this.pageNumberKey])
        .filter(p => p != null);

      const startPage = pageNumbers.length > 0 ? Math.min(...pageNumbers) : undefined;
      const endPage = pageNumbers.length > 0 ? Math.max(...pageNumbers) : undefined;

      // 继承第一个文档的基础 metadata
      const baseMeta = { ...windowDocs[0].metadata };
      // 清理单页相关的字段
      delete baseMeta[this.pageNumberKey];

      results.push(
        new Document({
          pageContent: mergedText,
          metadata: {
            ...baseMeta,
            mergedPages: true,
            windowIndex,
            windowSize: this.windowSize,
            windowOverlap: this.windowOverlap,
            pageRange: startPage != null ? [startPage, endPage] : undefined,
            pageCount: windowDocs.length,
          },
        }),
      );

      windowIndex++;

      // 如果窗口已经覆盖到最后一个文档，停止
      if (i + this.windowSize >= sorted.length) break;
    }

    this.logger.debug('页面合并完成', {
      inputCount: documents.length,
      outputCount: results.length,
      windowSize: this.windowSize,
      windowOverlap: this.windowOverlap,
    });

    return results;
  }
}
