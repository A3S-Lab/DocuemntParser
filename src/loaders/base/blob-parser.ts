import { Document } from '../../models/document.model';

/**
 * Blob 接口
 * 表示原始二进制数据
 *
 * 对齐 LangChain Python 的 Blob 模型
 */
export interface Blob {
  /**
   * 原始二进制数据
   */
  data: Buffer;

  /**
   * 元数据
   */
  metadata: Record<string, any>;

  /**
   * MIME 类型
   * @example 'application/pdf', 'text/plain', 'text/csv'
   */
  mimetype?: string;

  /**
   * 编码信息
   * @default 'utf-8'
   */
  encoding?: string;

  /**
   * 文件路径
   */
  path?: string;
}

/**
 * Blob 解析器抽象基类
 *
 * 负责将原始 Blob 数据解析为 Document 对象
 * 分离了数据加载和解析的关注点
 *
 * @example
 * ```typescript
 * class PDFParser extends BaseBlobParser {
 *   async *lazyParse(blob: Blob): AsyncGenerator<Document> {
 *     const pdf = await parsePDF(blob.data);
 *     for (let i = 0; i < pdf.numPages; i++) {
 *       const page = await pdf.getPage(i);
 *       yield new Document({
 *         pageContent: page.text,
 *         metadata: { ...blob.metadata, page: i }
 *       });
 *     }
 *   }
 * }
 * ```
 */
export abstract class BaseBlobParser {
  /**
   * 懒解析 Blob（子类必须实现）
   *
   * 使用 Generator 模式逐个生成文档
   *
   * @param blob - 要解析的 Blob 数据
   * @returns AsyncGenerator that yields Document objects
   */
  abstract lazyParse(blob: Blob): AsyncGenerator<Document>;

  /**
   * 解析 Blob（便捷方法）
   *
   * 将所有文档加载到内存中
   * 注意：对于大文件，推荐使用 lazyParse()
   *
   * @param blob - 要解析的 Blob 数据
   * @returns Promise that resolves with an array of Document instances
   */
  async parse(blob: Blob): Promise<Document[]> {
    const documents: Document[] = [];
    for await (const doc of this.lazyParse(blob)) {
      documents.push(doc);
    }
    return documents;
  }
}
