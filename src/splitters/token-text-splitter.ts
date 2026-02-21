import { TextSplitter, TextSplitterParams } from './text-splitter';

/**
 * TokenTextSplitter 配置参数
 */
export interface TokenTextSplitterParams extends TextSplitterParams {
  /**
   * 编码名称
   * @default "gpt2"
   */
  encodingName?: string;

  /**
   * 允许的特殊 token
   * @default []
   */
  allowedSpecial?: 'all' | string[];

  /**
   * 不允许的特殊 token
   * @default "all"
   */
  disallowedSpecial?: 'all' | string[];
}

/**
 * Token 文本分割器
 *
 * 基于 token 计数分割文本，适用于需要精确控制 token 数量的场景
 *
 * 注意：此实现使用字符长度作为 token 的近似值。
 * 如需精确的 token 计数，请使用 tiktoken 或类似的 tokenizer 库。
 *
 * @example
 * ```typescript
 * const splitter = new TokenTextSplitter({
 *   chunkSize: 1000,
 *   chunkOverlap: 200
 * });
 *
 * const chunks = await splitter.splitText(text);
 * ```
 */
export class TokenTextSplitter extends TextSplitter {
  encodingName: string;
  allowedSpecial: 'all' | string[];
  disallowedSpecial: 'all' | string[];

  constructor(params?: Partial<TokenTextSplitterParams>) {
    super(params);
    this.encodingName = params?.encodingName ?? 'gpt2';
    this.allowedSpecial = params?.allowedSpecial ?? [];
    this.disallowedSpecial = params?.disallowedSpecial ?? 'all';
  }

  /**
   * 分割文本
   *
   * 注意：此实现使用简单的字符分割作为 token 的近似。
   * 实际的 token 计数可能与此不同。
   */
  async splitText(text: string): Promise<string[]> {
    const splits: string[] = [];

    // 简单实现：按字符分割
    // 在实际应用中，应该使用 tiktoken 等库进行精确的 token 计数
    let startIdx = 0;
    const textLength = text.length;

    while (startIdx < textLength) {
      // 计算重叠
      if (startIdx > 0) {
        startIdx -= this.chunkOverlap;
      }

      const endIdx = Math.min(startIdx + this.chunkSize, textLength);
      const chunk = text.slice(startIdx, endIdx);
      splits.push(chunk);

      startIdx = endIdx;
    }

    return splits;
  }
}
