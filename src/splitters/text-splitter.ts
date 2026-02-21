import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { IDocumentTransformer } from '../common/interfaces/transformer.interface';

/**
 * TextSplitter 配置参数
 */
export interface TextSplitterParams {
  /**
   * 每个块的最大大小
   * @default 1000
   */
  chunkSize?: number;

  /**
   * 块之间的重叠大小
   * @default 200
   */
  chunkOverlap?: number;

  /**
   * 是否保留分隔符
   * @default false
   */
  keepSeparator?: boolean;

  /**
   * 自定义长度计算函数
   * @default (text) => text.length
   */
  lengthFunction?: (text: string) => number | Promise<number>;
}

/**
 * TextSplitter 抽象基类
 *
 * 参考 LangChain.js 设计，提供文本分割功能
 * 实现了 IDocumentTransformer 接口，可以与 Processor 互换使用
 */
export abstract class TextSplitter implements IDocumentTransformer {
  private readonly logger = new Logger(TextSplitter.name);
  protected chunkSize: number;
  protected chunkOverlap: number;
  protected keepSeparator: boolean;
  protected lengthFunction: (text: string) => number | Promise<number>;

  constructor(params: TextSplitterParams = {}) {
    this.chunkSize = params.chunkSize ?? 1000;
    this.chunkOverlap = params.chunkOverlap ?? 200;
    this.keepSeparator = params.keepSeparator ?? false;
    this.lengthFunction = params.lengthFunction ?? ((text: string) => text.length);

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error('chunkOverlap must be less than chunkSize');
    }
  }

  /**
   * 分割文本为多个块
   * 子类需要实现此方法
   */
  abstract splitText(text: string): Promise<string[]>;

  /**
   * 实现 IDocumentTransformer 接口
   * 转换文档（通过分割）
   */
  async transformDocuments(documents: Document[]): Promise<Document[]> {
    return this.splitDocuments(documents);
  }

  /**
   * 获取转换器名称
   */
  getName(): string {
    return this.constructor.name;
  }

  /**
   * 分割文档数组
   */
  async splitDocuments(documents: Document[]): Promise<Document[]> {
    const texts = documents.map((doc) => doc.pageContent);
    const metadatas = documents.map((doc) => doc.metadata);
    return this.createDocuments(texts, metadatas);
  }

  /**
   * 从文本数组创建文档
   */
  async createDocuments(
    texts: string[],
    metadatas: Record<string, any>[] = []
  ): Promise<Document[]> {
    const _metadatas =
      metadatas.length > 0
        ? metadatas
        : texts.map(() => ({}));

    const documents: Document[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      let chunkIndex = 0;

      for (const chunk of await this.splitText(text)) {
        documents.push(
          new Document({
            pageContent: chunk,
            metadata: {
              ..._metadatas[i],
              chunkIndex: chunkIndex++,
            },
          })
        );
      }
    }

    return documents;
  }

  /**
   * 根据分隔符分割文本
   */
  protected splitOnSeparator(text: string, separator: string): string[] {
    let splits: string[];

    if (separator) {
      if (this.keepSeparator) {
        // 保留分隔符，使用正向预查
        const escapedSeparator = separator.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
        splits = text.split(new RegExp(`(?=${escapedSeparator})`));
      } else {
        splits = text.split(separator);
      }
    } else {
      // 空分隔符，按字符分割
      splits = text.split('');
    }

    return splits.filter((s) => s !== '');
  }

  /**
   * 合并分割后的文本块
   */
  protected async mergeSplits(splits: string[], separator: string): Promise<string[]> {
    const docs: string[] = [];
    const currentDoc: string[] = [];
    let total = 0;

    for (const split of splits) {
      const len = await this.lengthFunction(split);

      // 检查是否超过块大小
      if (
        total + len + currentDoc.length * separator.length >
        this.chunkSize
      ) {
        if (total > this.chunkSize) {
          this.logger.warn(
            `Created a chunk of size ${total}, which is longer than the specified ${this.chunkSize}`
          );
        }

        if (currentDoc.length > 0) {
          const doc = this.joinDocs(currentDoc, separator);
          if (doc !== null) {
            docs.push(doc);
          }

          // 保持重叠部分
          while (
            currentDoc.length > 0 &&
            (total > this.chunkOverlap ||
              (total + len + currentDoc.length * separator.length > this.chunkSize &&
                total > 0))
          ) {
            total -= await this.lengthFunction(currentDoc[0]);
            currentDoc.shift();
          }
        }
      }

      currentDoc.push(split);
      total += len;
    }

    // 添加最后一个文档
    const doc = this.joinDocs(currentDoc, separator);
    if (doc !== null) {
      docs.push(doc);
    }

    return docs;
  }

  /**
   * 连接文档片段
   */
  private joinDocs(docs: string[], separator: string): string | null {
    const text = docs.join(separator).trim();
    return text === '' ? null : text;
  }
}
