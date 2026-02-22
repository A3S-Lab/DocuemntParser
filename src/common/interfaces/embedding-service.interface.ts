/**
 * Embedding 服务接口
 *
 * 定义 Document 模块所需的向量嵌入服务契约，
 * 可由外部模块自定义实现，或使用内置的 AI SDK 默认实现
 */
export interface IEmbeddingService {
  /**
   * 对单个文本生成嵌入向量
   *
   * @param text - 要嵌入的文本
   * @returns 嵌入向量
   */
  embed(text: string): Promise<number[]>;

  /**
   * 批量生成嵌入向量
   *
   * @param texts - 要嵌入的文本数组
   * @returns 嵌入向量数组
   */
  embedMany(texts: string[]): Promise<number[][]>;

  /**
   * 健康检查（可选）
   */
  healthCheck?(): Promise<void>;
}
