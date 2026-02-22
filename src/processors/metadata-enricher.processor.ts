import { randomUUID } from 'node:crypto';
import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';

/**
 * 元数据增强处理器
 *
 * 功能：
 * - 添加处理时间戳
 * - 计算内容统计信息
 * - 生成唯一 ID
 */
export class MetadataEnricherProcessor implements IDocumentProcessor {
  getName(): string {
    return 'MetadataEnricher';
  }

  getDescription(): string {
    return '增强文档元数据';
  }

  async process(documents: Document[]): Promise<Document[]> {
    return documents.map((doc, index) => {
      const content = doc.pageContent;

      // 计算统计信息
      const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
      const charCount = content.length;
      const lineCount = content.split('\n').length;

      // 生成唯一 ID
      const id = this.generateId(doc, index);

      return new Document({
        pageContent: content,
        metadata: {
          ...doc.metadata,
          // 添加统计信息
          wordCount,
          charCount,
          lineCount,
          // 添加时间戳
          processedAt: new Date().toISOString(),
          // 添加唯一 ID
          id,
        },
      });
    });
  }

  private generateId(_doc: Document, _index: number): string {
    return randomUUID();
  }
}
