import { Logger } from '@nestjs/common';
import { IEmbeddingService } from '../interfaces/embedding-service.interface';

/**
 * AI SDK Embedding 服务配置
 */
export interface AiSdkEmbeddingConfig {
  /** 模型名称 */
  modelName: string;
  /** 提供商名称 */
  providerName?: string;
  /** API Key */
  apiKey: string;
  /** API Base URL */
  baseUrl: string;
}

/**
 * 基于 AI SDK 的默认 Embedding 服务实现
 *
 * 使用 `ai` + `@ai-sdk/openai-compatible` 调用嵌入模型生成向量。
 *
 * 需要安装 peer dependencies:
 * ```bash
 * npm install ai @ai-sdk/openai-compatible
 * ```
 *
 * @example
 * ```typescript
 * const embeddingService = new AiSdkEmbeddingService({
 *   modelName: 'text-embedding-3-small',
 *   apiKey: 'sk-xxx',
 *   baseUrl: 'https://api.openai.com/v1',
 * });
 *
 * const vector = await embeddingService.embed('Hello world');
 * const vectors = await embeddingService.embedMany(['Hello', 'World']);
 * ```
 */
export class AiSdkEmbeddingService implements IEmbeddingService {
  private readonly logger = new Logger(AiSdkEmbeddingService.name);
  private model: any;
  private embedFn: any;
  private embedManyFn: any;

  constructor(private readonly config: AiSdkEmbeddingConfig) {}

  /**
   * 延迟加载 AI SDK 依赖
   */
  private async ensureModel(): Promise<void> {
    if (this.model) return;

    try {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      const ai = await import('ai');

      this.model = createOpenAICompatible({
        baseURL: this.config.baseUrl,
        name: this.config.providerName || 'embedding-provider',
        apiKey: this.config.apiKey,
      }).textEmbeddingModel(this.config.modelName);

      this.embedFn = ai.embed;
      this.embedManyFn = ai.embedMany;
    } catch (error) {
      throw new Error(
        '需要安装 ai 和 @ai-sdk/openai-compatible 依赖才能使用默认 Embedding 服务。\n' +
        '请运行: npm install ai @ai-sdk/openai-compatible',
      );
    }
  }

  /**
   * 对单个文本生成嵌入向量
   */
  async embed(text: string): Promise<number[]> {
    await this.ensureModel();

    const { embedding } = await this.embedFn({
      model: this.model,
      value: text,
    });

    return embedding;
  }

  /**
   * 批量生成嵌入向量
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    await this.ensureModel();

    const { embeddings } = await this.embedManyFn({
      model: this.model,
      values: texts,
    });

    return embeddings;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<void> {
    await this.ensureModel();
    // 用一个简短文本测试
    await this.embed('health check');
    this.logger.debug('Embedding 服务健康检查通过');
  }
}
