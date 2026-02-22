import { Document } from '../models/document.model';
import { BufferLoader, BufferLoaderOptions } from './base/buffer.loader';

/**
 * JSON 加载器配置选项
 */
export interface JSONLoaderOptions extends BufferLoaderOptions {
  /**
   * JSON 路径（类似 jq 语法）
   * 例如:
   * - ".data" - 提取 data 字段
   * - ".items[]" - 提取 items 数组中的每个元素
   * - ".users[].name" - 提取 users 数组中每个对象的 name 字段
   */
  jsonPath?: string;

  /**
   * 内容字段名
   * 如果指定，将从对象中提取该字段作为 pageContent
   */
  contentKey?: string;

  /**
   * 元数据字段
   * 这些字段会被添加到 metadata，而不是 pageContent
   */
  metadataKeys?: string[];

  /**
   * 是否格式化输出
   * @default true
   */
  prettify?: boolean;
}

/**
 * JSON 加载器 - 处理 JSON 文件
 *
 * 参考 LangChain Python 设计
 * 支持 JSON 路径提取和字段映射
 *
 * @example
 * ```typescript
 * // 基础用法：整个 JSON 作为一个 Document
 * const loader = new JSONLoader('data.json');
 * const docs = await loader.load();
 * // 返回: [Document(格式化的 JSON 字符串)]
 *
 * // 提取数组中的每个元素
 * const loader = new JSONLoader('data.json', { jsonPath: '.items[]' });
 * const docs = await loader.load();
 * // 返回: [Document(item1), Document(item2), ...]
 *
 * // 指定内容字段和元数据字段
 * const loader = new JSONLoader('data.json', {
 *   jsonPath: '.users[]',
 *   contentKey: 'bio',
 *   metadataKeys: ['name', 'email']
 * });
 * ```
 */
export class JSONLoader extends BufferLoader {
  private jsonPath?: string;
  private contentKey?: string;
  private metadataKeys: string[];
  private prettify: boolean;

  constructor(
    filePathOrBlob: string | Blob,
    options: JSONLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.jsonPath = options.jsonPath;
    this.contentKey = options.contentKey;
    this.metadataKeys = options.metadataKeys ?? [];
    this.prettify = options.prettify ?? true;
  }

  /**
   * 解析 JSON buffer 并返回文档数组
   *
   * @param raw - JSON buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const text = raw.toString(this.encoding);
    const json = JSON.parse(text);

    // 如果没有指定 jsonPath，返回整个 JSON
    if (!this.jsonPath) {
      const content = this.prettify
        ? JSON.stringify(json, null, 2)
        : JSON.stringify(json);

      return [
        new Document({
          pageContent: content,
          metadata: {
            ...metadata,
            format: 'json',
          },
        }),
      ];
    }

    // 使用 jsonPath 提取数据
    const extracted = this.extractByPath(json, this.jsonPath);
    const items = Array.isArray(extracted) ? extracted : [extracted];

    return items.map((item, index) => {
      const { content, itemMetadata } = this.extractContent(item);

      return new Document({
        pageContent: content,
        metadata: {
          ...metadata,
          ...itemMetadata,
          format: 'json',
          index,
        },
      });
    });
  }

  /**
   * 根据 JSON 路径提取数据
   */
  private extractByPath(data: any, path: string): any {
    // 移除开头的点
    const cleanPath = path.startsWith('.') ? path.slice(1) : path;

    if (!cleanPath) {
      return data;
    }

    // 简单的路径解析（支持 .field 和 .field[] 语法）
    const parts = cleanPath.split('.');
    let current = data;

    for (const part of parts) {
      if (part.endsWith('[]')) {
        // 数组展开
        const field = part.slice(0, -2);
        if (field) {
          current = current[field];
        }
        // 如果是数组，保持为数组
        if (!Array.isArray(current)) {
          throw new Error(`Expected array at path: ${field}`);
        }
      } else {
        // 普通字段访问
        current = current[part];
      }

      if (current === undefined) {
        throw new Error(`Path not found: ${path}`);
      }
    }

    return current;
  }

  /**
   * 从对象中提取内容和元数据
   */
  private extractContent(item: any): {
    content: string;
    itemMetadata: Record<string, any>;
  } {
    if (typeof item !== 'object' || item === null) {
      // 基本类型，直接转换为字符串
      return {
        content: String(item),
        itemMetadata: {},
      };
    }

    const itemMetadata: Record<string, any> = {};
    let contentObj: any = { ...item };

    // 提取元数据字段
    for (const key of this.metadataKeys) {
      if (key in item) {
        itemMetadata[key] = item[key];
        delete contentObj[key];
      }
    }

    // 提取内容字段
    let content: string;
    if (this.contentKey && this.contentKey in item) {
      const contentValue = item[this.contentKey];
      content =
        typeof contentValue === 'string'
          ? contentValue
          : JSON.stringify(contentValue, null, this.prettify ? 2 : 0);
    } else {
      // 使用剩余字段作为内容
      content = this.prettify
        ? JSON.stringify(contentObj, null, 2)
        : JSON.stringify(contentObj);
    }

    return { content, itemMetadata };
  }
}
