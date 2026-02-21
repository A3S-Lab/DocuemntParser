import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';
import { MarkdownHeaderTextSplitter } from '../splitters/markdown-header-text-splitter';

/**
 * Markdown 切分处理器
 *
 * 功能：
 * - 按标题层级切分文档
 * - 保留标题信息到 metadata
 * - 保持语义完整性
 */
export class MarkdownSplitterProcessor implements IDocumentProcessor {
  private splitter: MarkdownHeaderTextSplitter;

  constructor() {
    this.splitter = new MarkdownHeaderTextSplitter({
      headersToSplitOn: [
        { marker: '#', name: 'Header 1' },
        { marker: '##', name: 'Header 2' },
        { marker: '###', name: 'Header 3' },
      ],
      stripHeaders: false,
      returnEachLine: false,
    });
  }

  getName(): string {
    return 'MarkdownSplitter';
  }

  getDescription(): string {
    return '按 Markdown 标题层级切分文档';
  }

  async process(documents: Document[]): Promise<Document[]> {
    return this.splitter.splitDocuments(documents);
  }
}
