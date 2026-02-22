import { Document } from '../models/document.model';

/**
 * RecursiveJsonSplitter 配置参数
 */
export interface RecursiveJsonSplitterParams {
  /**
   * 最大块大小
   * @default 2000
   */
  maxChunkSize?: number;

  /**
   * 最小块大小
   * @default 1800
   */
  minChunkSize?: number;
}

/**
 * 递归 JSON 分割器
 *
 * 将 JSON 数据分割成更小的结构化块，同时保留层级结构
 *
 * @example
 * ```typescript
 * const splitter = new RecursiveJsonSplitter({
 *   maxChunkSize: 2000,
 *   minChunkSize: 1800
 * });
 *
 * const jsonData = { ... };
 * const chunks = await splitter.splitJson(jsonData);
 * ```
 */
export class RecursiveJsonSplitter {
  private maxChunkSize: number;
  private minChunkSize: number;

  constructor(params: RecursiveJsonSplitterParams = {}) {
    this.maxChunkSize = params.maxChunkSize ?? 2000;
    this.minChunkSize = params.minChunkSize ?? Math.max(this.maxChunkSize - 200, 50);
  }

  /**
   * 分割 JSON 数据
   */
  async splitJson(data: any): Promise<any[]> {
    // 将列表转换为字典以便更好地分块
    const preprocessedData = this.listToDictPreprocessing(data);

    // 递归分割
    const chunks = this.jsonSplit(preprocessedData);

    return chunks;
  }

  /**
   * 分割文本（JSON 字符串）
   */
  async splitText(text: string): Promise<string[]> {
    try {
      const jsonData = JSON.parse(text);
      const chunks = await this.splitJson(jsonData);
      return chunks.map((chunk) => JSON.stringify(chunk, null, 2));
    } catch (error) {
      throw new Error(`Invalid JSON: ${error}`);
    }
  }

  /**
   * 创建文档
   */
  async createDocuments(texts: string[]): Promise<Document[]> {
    const documents: Document[] = [];

    for (const text of texts) {
      const chunks = await this.splitText(text);
      for (let i = 0; i < chunks.length; i++) {
        documents.push(
          new Document({
            pageContent: chunks[i],
            metadata: {
              chunkIndex: i.toString(),
              totalChunks: chunks.length.toString(),
            },
          })
        );
      }
    }

    return documents;
  }

  /**
   * 分割文档
   */
  async splitDocuments(documents: Document[]): Promise<Document[]> {
    const allDocs: Document[] = [];

    for (const doc of documents) {
      const chunks = await this.splitText(doc.pageContent);

      for (let i = 0; i < chunks.length; i++) {
        allDocs.push(
          new Document({
            pageContent: chunks[i],
            metadata: {
              ...doc.metadata,
              chunkIndex: i.toString(),
              totalChunks: chunks.length.toString(),
            },
          })
        );
      }
    }

    return allDocs;
  }

  /**
   * 计算 JSON 大小
   */
  private jsonSize(data: any): number {
    return JSON.stringify(data).length;
  }

  /**
   * 设置嵌套字典的值
   */
  private setNestedDict(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * 将列表转换为字典
   */
  private listToDictPreprocessing(data: any): any {
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      // 处理对象
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.listToDictPreprocessing(value);
      }
      return result;
    } else if (Array.isArray(data)) {
      // 将数组转换为对象
      const result: any = {};
      for (let i = 0; i < data.length; i++) {
        result[i.toString()] = this.listToDictPreprocessing(data[i]);
      }
      return result;
    }
    // 基本类型直接返回
    return data;
  }

  /**
   * 递归分割 JSON
   */
  private jsonSplit(data: any, currentPath: string[] = [], chunks: any[] = [{}]): any[] {
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data)) {
        const newPath = [...currentPath, key];
        const chunkSize = this.jsonSize(chunks[chunks.length - 1]);
        const size = this.jsonSize({ [key]: value });
        const remaining = this.maxChunkSize - chunkSize;

        if (size < remaining) {
          // 可以添加到当前块
          this.setNestedDict(chunks[chunks.length - 1], newPath, value);
        } else {
          // 需要新块
          if (chunkSize > this.minChunkSize) {
            // 当前块已经足够大，创建新块
            chunks.push({});
          }

          // 递归处理值
          if (typeof value === 'object' && value !== null) {
            this.jsonSplit(value, newPath, chunks);
          } else {
            this.setNestedDict(chunks[chunks.length - 1], newPath, value);
          }
        }
      }
    } else {
      // 非对象类型，直接设置
      this.setNestedDict(chunks[chunks.length - 1], currentPath, data);
    }

    return chunks;
  }
}
