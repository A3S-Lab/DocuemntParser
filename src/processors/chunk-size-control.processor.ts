import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';
import { RecursiveCharacterTextSplitter } from '../splitters/recursive-character-text-splitter';

/**
 * 大小控制处理器
 *
 * 功能：
 * - 确保每个 chunk 不超过指定大小
 * - 对所有 chunk 进行带重叠的切分（保证上下文连续性）
 * - 适配 embedding 模型的 token 限制
 */
export class ChunkSizeControlProcessor implements IDocumentProcessor {
  private splitter: RecursiveCharacterTextSplitter;
  private maxChunkSize: number;
  private forceOverlap: boolean;

  /**
   * @param maxChunkSize - 最大 chunk 大小（字符数）
   * @param chunkOverlap - chunk 之间的重叠大小（字符数）
   * @param forceOverlap - 是否强制对所有文档进行带重叠的切分（默认 true）
   */
  constructor(maxChunkSize = 1000, chunkOverlap = 200, forceOverlap = true) {
    this.maxChunkSize = maxChunkSize;
    this.forceOverlap = forceOverlap;
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: maxChunkSize,
      chunkOverlap,
      separators: ['\n## ', '\n### ', '\n\n', '\n', ' ', ''],
    });
  }

  getName(): string {
    return 'ChunkSizeControl';
  }

  getDescription(): string {
    return `控制 chunk 大小不超过 ${this.maxChunkSize} 字符，带重叠切分`;
  }

  async process(documents: Document[]): Promise<Document[]> {
    const result: Document[] = [];

    for (const doc of documents) {
      if (this.forceOverlap) {
        // 强制对所有文档进行带重叠的切分
        const subChunks = await this.splitter.splitDocuments([doc]);
        result.push(...subChunks);
      } else {
        // 仅对超过大小限制的文档进行切分
        if (doc.pageContent.length <= this.maxChunkSize) {
          result.push(doc);
        } else {
          const subChunks = await this.splitter.splitDocuments([doc]);
          result.push(...subChunks);
        }
      }
    }

    return result;
  }
}
