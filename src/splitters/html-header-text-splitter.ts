import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { Document } from '../models/document.model';

/**
 * HTML 标题分割配置
 */
export interface HTMLHeaderToSplitOn {
  /**
   * HTML 标签名（如 "h1", "h2", "h3"）
   */
  tag: string;

  /**
   * 标题名称（用于元数据）
   */
  name: string;
}

/**
 * HTMLHeaderTextSplitter 配置参数
 */
export interface HTMLHeaderTextSplitterParams {
  /**
   * 要分割的标题标签
   * @example [{ tag: 'h1', name: 'Header 1' }, { tag: 'h2', name: 'Header 2' }]
   */
  headersToSplitOn: HTMLHeaderToSplitOn[];

  /**
   * 是否返回每个元素（而不是合并的块）
   * @default false
   */
  returnEachElement?: boolean;
}

/**
 * HTML 标题文本分割器
 *
 * 根据 HTML 标题标签分割文档，保留文档结构和上下文
 *
 * @example
 * ```typescript
 * const splitter = new HTMLHeaderTextSplitter({
 *   headersToSplitOn: [
 *     { tag: 'h1', name: 'Header 1' },
 *     { tag: 'h2', name: 'Header 2' },
 *     { tag: 'h3', name: 'Header 3' }
 *   ]
 * });
 *
 * const docs = await splitter.splitText(htmlContent);
 * ```
 */
export class HTMLHeaderTextSplitter {
  private headersToSplitOn: HTMLHeaderToSplitOn[];
  private returnEachElement: boolean;
  private headerMapping: Map<string, string>;
  private headerTags: string[];

  constructor(params: HTMLHeaderTextSplitterParams) {
    this.headersToSplitOn = params.headersToSplitOn;
    this.returnEachElement = params.returnEachElement ?? false;

    // 按标签的数字级别排序（h1 < h2 < h3...）
    this.headersToSplitOn.sort((a, b) => {
      const aLevel = parseInt(a.tag.substring(1));
      const bLevel = parseInt(b.tag.substring(1));
      return aLevel - bLevel;
    });

    this.headerMapping = new Map(this.headersToSplitOn.map(h => [h.tag, h.name]));
    this.headerTags = this.headersToSplitOn.map(h => h.tag);
  }

  /**
   * 分割 HTML 文本
   */
  async splitText(text: string): Promise<Document[]> {
    const $ = cheerio.load(text);
    const bodyElement = $('body').length > 0 ? $('body').get(0) : $.root().get(0);

    if (!bodyElement) {
      return [];
    }

    const documents: Document[] = [];

    // 活动标题：key = 标题名称, value = { text, level, depth }
    const activeHeaders: Map<string, { text: string; level: number; depth: number }> = new Map();
    let currentChunk: string[] = [];

    const finalizeChunk = (): Document | null => {
      if (currentChunk.length === 0) {
        return null;
      }

      const content = currentChunk.filter(line => line.trim()).join('  \n').trim();
      currentChunk = [];

      if (!content) {
        return null;
      }

      const metadata: Record<string, string> = {};
      activeHeaders.forEach((value, key) => {
        metadata[key] = value.text;
      });

      return new Document({
        pageContent: content,
        metadata,
      });
    };

    // 使用栈进行 DFS 遍历
    const stack: Element[] = [bodyElement as Element];

    while (stack.length > 0) {
      const node = stack.pop()!;

      // 获取子节点并反向压入栈（保持顺序）
      const children = $(node).children().get() as Element[];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }

      const tagName = node.name?.toLowerCase();
      if (!tagName) {
        continue;
      }

      // 只获取当前节点的直接文本内容（不递归）
      const textElements = $(node)
        .contents()
        .filter(function () {
          return this.type === 'text';
        })
        .toArray()
        .map(el => $(el).text().trim())
        .filter(t => t);

      const nodeText = textElements.join(' ').trim();
      if (!nodeText) {
        continue;
      }

      // 计算 DOM 深度
      const domDepth = $(node).parents().length;

      // 检查是否为标题标签
      if (this.headerTags.includes(tagName)) {
        // 如果正在聚合，先完成当前块
        if (!this.returnEachElement) {
          const doc = finalizeChunk();
          if (doc) {
            documents.push(doc);
          }
        }

        // 获取标题级别
        const level = parseInt(tagName.substring(1));

        // 移除相同或更低级别的标题
        const keysToRemove: string[] = [];
        activeHeaders.forEach((value, key) => {
          if (value.level >= level) {
            keysToRemove.push(key);
          }
        });
        keysToRemove.forEach(key => activeHeaders.delete(key));

        // 添加当前标题
        const headerName = this.headerMapping.get(tagName);
        if (headerName) {
          activeHeaders.set(headerName, { text: nodeText, level, depth: domDepth });

          // 标题本身作为一个 Document 返回
          const headerMetadata: Record<string, string> = {};
          activeHeaders.forEach((value, key) => {
            headerMetadata[key] = value.text;
          });
          documents.push(new Document({
            pageContent: nodeText,
            metadata: headerMetadata,
          }));
        }
      } else {
        // 移除超出作用域的标题（DOM 深度更深的）
        const keysToRemove: string[] = [];
        activeHeaders.forEach((value, key) => {
          if (domDepth < value.depth) {
            keysToRemove.push(key);
          }
        });
        keysToRemove.forEach(key => activeHeaders.delete(key));

        if (this.returnEachElement) {
          // 每个元素作为独立 Document
          const metadata: Record<string, string> = {};
          activeHeaders.forEach((value, key) => {
            metadata[key] = value.text;
          });
          documents.push(new Document({
            pageContent: nodeText,
            metadata,
          }));
        } else {
          // 累积到当前块
          currentChunk.push(nodeText);
        }
      }
    }

    // 处理剩余的块
    if (!this.returnEachElement) {
      const doc = finalizeChunk();
      if (doc) {
        documents.push(doc);
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
      const splitDocs = await this.splitText(doc.pageContent);

      // 合并原始文档的元数据
      for (const splitDoc of splitDocs) {
        splitDoc.metadata = {
          ...doc.metadata,
          ...splitDoc.metadata,
        };
      }

      allDocs.push(...splitDocs);
    }

    return allDocs;
  }

  /**
   * 从 URL 分割 HTML
   *
   * 安全限制：
   * - 仅允许 http/https 协议
   * - 30 秒超时
   * - 最大响应体 10MB
   */
  async splitTextFromUrl(url: string): Promise<Document[]> {
    // 仅允许 http/https，防止 SSRF（file://, ftp:// 等）
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol} (only http/https allowed)`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      // 检查 Content-Length（如果有）
      const maxSize = 10 * 1024 * 1024; // 10MB
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${maxSize})`);
      }

      const html = await response.text();
      if (html.length > maxSize) {
        throw new Error(`Response body too large: ${html.length} chars (max: ${maxSize})`);
      }

      return this.splitText(html);
    } finally {
      clearTimeout(timeout);
    }
  }
}
