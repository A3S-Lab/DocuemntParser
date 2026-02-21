import { Document } from '../../models/document.model';

/**
 * 文档转换器接口
 *
 * 统一的文档转换接口，用于文档切分、清理、增强等操作
 * 对齐 LangChain Python 的 BaseDocumentTransformer
 *
 * TextSplitter 和 Processor 都实现此接口，可以互换使用
 *
 * @example
 * ```typescript
 * // 统一使用转换器
 * const transformers: IDocumentTransformer[] = [
 *   new RecursiveCharacterTextSplitter({ chunkSize: 1000 }),
 *   new TextCleanerProcessor(),
 *   new MetadataEnricherProcessor()
 * ];
 *
 * let docs = await loader.load();
 * for (const transformer of transformers) {
 *   docs = await transformer.transformDocuments(docs);
 * }
 * ```
 */
export interface IDocumentTransformer {
  /**
   * 转换文档
   *
   * 接收一组文档，返回转换后的文档
   * 可以是切分、清理、增强等任何转换操作
   *
   * @param documents - 要转换的文档数组
   * @returns 转换后的文档数组
   *
   * @example
   * ```typescript
   * class MyTransformer implements IDocumentTransformer {
   *   async transformDocuments(documents: Document[]): Promise<Document[]> {
   *     return documents.map(doc => ({
   *       ...doc,
   *       pageContent: doc.pageContent.toUpperCase()
   *     }));
   *   }
   * }
   * ```
   */
  transformDocuments(documents: Document[]): Promise<Document[]>;

  /**
   * 获取转换器名称
   *
   * 用于日志、调试和错误追踪
   *
   * @returns 转换器名称
   */
  getName(): string;
}
