import { Document } from '../../models/document.model';

/**
 * 文档处理器接口
 *
 * 用于文档处理管道，可以对文档进行转换、过滤、增强等操作
 *
 * @example
 * ```typescript
 * class TextCleanerProcessor implements IDocumentProcessor {
 *   getName(): string {
 *     return 'TextCleaner';
 *   }
 *
 *   async process(documents: Document[]): Promise<Document[]> {
 *     return documents.map(doc => ({
 *       ...doc,
 *       pageContent: doc.pageContent.trim()
 *     }));
 *   }
 * }
 * ```
 */
export interface IDocumentProcessor {
  /**
   * 处理器名称（用于日志和调试）
   */
  getName(): string;

  /**
   * 处理文档
   *
   * @param documents - 要处理的文档数组
   * @returns 处理后的文档数组
   */
  process(documents: Document[]): Promise<Document[]>;

  /**
   * 获取处理器描述（可选）
   */
  getDescription?(): string;
}
