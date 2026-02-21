import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { IDocumentProcessor } from '../common/interfaces/processor.interface';
import { IEmbeddingService } from '../common/interfaces/embedding-service.interface';

/**
 * Embedding 处理器配置
 */
export interface EmbeddingProcessorOptions {
  /**
   * Embedding 服务实例
   * 可传入自定义实现或使用 AiSdkEmbeddingService
   */
  embeddingService: IEmbeddingService;

  /**
   * 批量大小（每次发送给 embedding 模型的文本数量）
   * @default 32
   */
  batchSize?: number;

  /**
   * 存储 embedding 向量的 metadata 字段名
   * @default 'embedding'
   */
  metadataKey?: string;

  /**
   * 是否在 embedding 失败时跳过（而非抛出错误）
   * @default false
   */
  skipOnError?: boolean;
}

/**
 * Embedding 处理器
 *
 * 在文档处理管道中为每个文档的 pageContent 生成嵌入向量，
 * 并将向量存储到 metadata 中。
 *
 * 支持自定义 IEmbeddingService 实现，默认可使用 AiSdkEmbeddingService。
 *
 * @example
 * ```typescript
 * import { EmbeddingProcessor, AiSdkEmbeddingService } from '@nestify/document';
 *
 * const embeddingService = new AiSdkEmbeddingService({
 *   modelName: 'text-embedding-3-small',
 *   apiKey: 'sk-xxx',
 *   baseUrl: 'https://api.openai.com/v1',
 * });
 *
 * DocumentModule.register({
 *   processors: [
 *     new TextCleanerProcessor(),
 *     new ChunkSizeControlProcessor({ maxChunkSize: 2000 }),
 *     new EmbeddingProcessor({ embeddingService }),
 *   ],
 * });
 * ```
 */
export class EmbeddingProcessor implements IDocumentProcessor {
  private readonly logger = new Logger(EmbeddingProcessor.name);
  private readonly embeddingService: IEmbeddingService;
  private readonly batchSize: number;
  private readonly metadataKey: string;
  private readonly skipOnError: boolean;

  constructor(options: EmbeddingProcessorOptions) {
    this.embeddingService = options.embeddingService;
    this.batchSize = options.batchSize ?? 32;
    this.metadataKey = options.metadataKey ?? 'embedding';
    this.skipOnError = options.skipOnError ?? false;
  }

  getName(): string {
    return 'EmbeddingProcessor';
  }

  getDescription(): string {
    return '为文档生成嵌入向量并存储到 metadata 中';
  }

  async process(documents: Document[]): Promise<Document[]> {
    if (documents.length === 0) return documents;

    const results: Document[] = [];

    // 按批次处理
    for (let i = 0; i < documents.length; i += this.batchSize) {
      const batch = documents.slice(i, i + this.batchSize);
      const texts = batch.map(doc => doc.pageContent);

      try {
        const embeddings = await this.embeddingService.embedMany(texts);

        for (let j = 0; j < batch.length; j++) {
          results.push(
            new Document({
              pageContent: batch[j].pageContent,
              metadata: {
                ...batch[j].metadata,
                [this.metadataKey]: embeddings[j],
              },
            }),
          );
        }

        this.logger.debug(`Embedding 批次完成`, {
          batchIndex: Math.floor(i / this.batchSize),
          batchSize: batch.length,
          dimensions: embeddings[0]?.length,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Embedding 批次失败`, {
          batchIndex: Math.floor(i / this.batchSize),
          error: errorMsg,
        });

        if (this.skipOnError) {
          // 跳过失败的批次，保留原始文档（不含 embedding）
          results.push(...batch);
        } else {
          throw error;
        }
      }
    }

    this.logger.debug(`Embedding 处理完成`, {
      totalDocuments: documents.length,
      processedDocuments: results.length,
    });

    return results;
  }
}
