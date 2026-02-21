import { TextSplitter, TextSplitterParams } from './text-splitter';

/**
 * CharacterTextSplitter 配置参数
 */
export interface CharacterTextSplitterParams extends TextSplitterParams {
  /**
   * 用于分割文本的分隔符
   * @default "\n\n"
   */
  separator?: string;
}

/**
 * 字符文本分割器
 *
 * 使用指定的分隔符分割文本
 *
 * @example
 * ```typescript
 * const splitter = new CharacterTextSplitter({
 *   separator: '\n\n',
 *   chunkSize: 1000,
 *   chunkOverlap: 200
 * });
 *
 * const chunks = await splitter.splitText(text);
 * ```
 */
export class CharacterTextSplitter extends TextSplitter {
  private separator: string;

  constructor(params: CharacterTextSplitterParams = {}) {
    super(params);
    this.separator = params.separator ?? '\n\n';
  }

  /**
   * 分割文本
   */
  async splitText(text: string): Promise<string[]> {
    // 首先按分隔符分割
    const splits = this.splitOnSeparator(text, this.separator);

    // 然后合并分割后的文本块
    return this.mergeSplits(
      splits,
      this.keepSeparator ? '' : this.separator
    );
  }
}
