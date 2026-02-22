import { randomUUID } from 'crypto';

/**
 * Document 输入接口
 */
export interface DocumentInput<
  Metadata extends Record<string, any> = Record<string, any>
> {
  /**
   * 文档内容
   */
  pageContent: string;

  /**
   * 元数据
   */
  metadata?: Metadata;

  /**
   * 文档 ID（可选）
   */
  id?: string;
}

/**
 * 文档接口
 */
export interface DocumentInterface<
  Metadata extends Record<string, any> = Record<string, any>
> {
  pageContent: string;
  metadata: Metadata;
  id?: string;
}

/**
 * 文档模型 - 参考 LangChain.js 设计
 *
 * 表示一个文档单元，包含内容和元数据
 */
export class Document<
  Metadata extends Record<string, any> = Record<string, any>
> implements DocumentInterface<Metadata> {
  /**
   * 文档内容
   */
  pageContent: string;

  /**
   * 元数据
   */
  metadata: Metadata;

  /**
   * 文档 ID
   */
  id?: string;

  constructor(fields: DocumentInput<Metadata>) {
    this.pageContent = fields.pageContent !== undefined
      ? fields.pageContent.toString()
      : '';
    this.metadata = fields.metadata ?? ({} as Metadata);
    this.id = fields.id ?? randomUUID();
  }
}
