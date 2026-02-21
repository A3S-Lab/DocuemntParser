import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';

/**
 * 文本清理处理器
 *
 * 功能：
 * - 去除多余空白
 * - 统一换行符
 * - 移除特殊字符
 */
export class TextCleanerProcessor implements IDocumentProcessor {
  getName(): string {
    return 'TextCleaner';
  }

  getDescription(): string {
    return '清理文本中的多余空白和特殊字符';
  }

  async process(documents: Document[]): Promise<Document[]> {
    return documents.map(doc => {
      let content = doc.pageContent;

      // 统一换行符
      content = content.replace(/\r\n/g, '\n');

      // 去除多余空白（保留段落间的空行）
      content = content.replace(/[ \t]+/g, ' ');
      content = content.replace(/\n{3,}/g, '\n\n');

      // 去除行首行尾空白
      content = content.split('\n').map(line => line.trim()).join('\n');

      return new Document({
        pageContent: content,
        metadata: doc.metadata,
      });
    });
  }
}
