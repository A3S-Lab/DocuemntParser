import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { BufferLoader, BufferLoaderOptions } from './base/buffer.loader';

/**
 * HTML 加载器配置选项
 */
export interface HTMLLoaderOptions extends BufferLoaderOptions {
  /**
   * 是否按元素分割（仅在降级到简单解析时有效）
   * - true: 每个主要元素（h1, h2, p 等）返回一个 Document
   * - false: 整个文档返回一个 Document
   * @default false
   */
  splitByElements?: boolean;

  /**
   * 要分割的元素标签（仅在 splitByElements=true 时有效）
   * @default ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'article', 'section']
   */
  splitTags?: string[];
}

/**
 * HTML 加载器 - 处理 HTML 文件
 *
 * 自动降级策略：
 * - 优先: Turndown 转换为 Markdown（专业 HTML 转换，保留结构）
 * - 降级: 简单正则提取（去除标签，提取纯文本）
 *
 * 主要依赖: npm install turndown
 *
 * 特别适合 RAG 场景：
 * - 智能去除导航、广告、脚本等噪音
 * - 保留语义结构（标题、列表、链接）
 * - 输出干净的 Markdown 格式
 *
 * @example
 * ```typescript
 * // 转换为 Markdown（自动尝试 Turndown，失败则降级）
 * const loader = new HTMLLoader('page.html');
 * const docs = await loader.load();
 * // 返回: [Document(Markdown格式)] 或 [Document(纯文本)]
 *
 * // 按元素分割（仅在降级时生效）
 * const loader = new HTMLLoader('page.html', {
 *   splitByElements: true,
 *   splitTags: ['h1', 'h2', 'p']
 * });
 * const docs = await loader.load();
 * // 返回: [Document(h1), Document(h2), Document(p), ...]
 * ```
 */
export class HTMLLoader extends BufferLoader {
  protected static readonly logger = new Logger(HTMLLoader.name);
  private static turndownPromise: Promise<any> | null = null;
  private splitByElements: boolean;
  private splitTags: string[];

  constructor(
    filePathOrBlob: string | Blob,
    options: HTMLLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.splitByElements = options.splitByElements ?? false;
    this.splitTags = options.splitTags ?? [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'article',
      'section',
    ];
  }

  /**
   * 解析 HTML buffer 并返回文档数组
   *
   * 优先尝试 Turndown 转换，失败则自动降级
   *
   * @param raw - HTML buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const html = raw.toString(this.encoding);

    // 优先尝试 Turndown 转换为 Markdown
    try {
      return await this.parseWithTurndown(html, metadata);
    } catch (turndownError) {
      HTMLLoader.logger.warn(
        'Turndown conversion failed for HTML, falling back to simple extraction:',
        turndownError instanceof Error ? turndownError.message : turndownError
      );

      // 降级到简单正则提取
      return this.parseWithRegex(html, metadata);
    }
  }

  /**
   * 获取或创建 TurndownService 单例（Promise 缓存防止并发竞态）
   */
  private static getTurndownService(): Promise<any> {
    if (!HTMLLoader.turndownPromise) {
      HTMLLoader.turndownPromise = (async () => {
        const TurndownService = await HTMLLoader.importsTurndown();
        const { gfm } = await HTMLLoader.importGfmPlugin();

        const instance = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-',
          emDelimiter: '*',
        });

        instance.use(gfm);
        instance.remove(['script', 'style', 'nav', 'footer', 'header', 'aside']);

        return instance;
      })().catch((err) => {
        // 初始化失败时清除缓存，允许重试
        HTMLLoader.turndownPromise = null;
        throw err;
      });
    }
    return HTMLLoader.turndownPromise;
  }

  /**
   * 使用 Turndown 转换为 Markdown
   */
  private async parseWithTurndown(
    html: string,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const turndownService = await HTMLLoader.getTurndownService();

    let markdown = turndownService.turndown(html);

    // 后处理：移除 Markdown 中不必要的转义字符（适用于 RAG 场景）
    // 1. 表格中的下划线不需要转义
    markdown = markdown.replace(/(\|[^|\n]*)\\_([^|\n]*)/g, '$1_$2');
    // 2. 代码块外的星号转义（保留代码块内的）
    // 注意：这里只处理明显不需要转义的情况，避免破坏真正的 Markdown 语法

    return [
      new Document({
        pageContent: markdown,
        metadata: {
          ...metadata,
          format: 'markdown',
          originalFormat: 'html',
          convertedBy: 'turndown',
        },
      }),
    ];
  }

  /**
   * 降级方案：使用简单正则提取
   */
  private parseWithRegex(
    html: string,
    metadata: Document['metadata']
  ): Document[] {
    if (this.splitByElements) {
      return this.parseByElements(html, metadata);
    }

    const text = this.stripHtml(html);

    return [
      new Document({
        pageContent: text,
        metadata: {
          ...metadata,
          format: 'text',
          originalFormat: 'html',
          extractedBy: 'regex',
        },
      }),
    ];
  }

  /**
   * 按元素分割 HTML
   */
  private parseByElements(
    html: string,
    metadata: Document['metadata']
  ): Document[] {
    const documents: Document[] = [];

    // 移除 script 和 style 标签
    let cleanHtml = html.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      ''
    );
    cleanHtml = cleanHtml.replace(
      /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
      ''
    );

    // 为每个目标标签创建正则表达式
    for (const tag of this.splitTags) {
      const regex = new RegExp(
        `<${tag}\\b[^>]*>(.*?)<\\/${tag}>`,
        'gis'
      );
      let match: RegExpExecArray | null;

      while ((match = regex.exec(cleanHtml)) !== null) {
        const content = this.stripTags(match[1]).trim();

        if (content) {
          documents.push(
            new Document({
              pageContent: content,
              metadata: {
                ...metadata,
                format: 'text',
                originalFormat: 'html',
                extractedBy: 'regex',
                element: tag,
                position: match.index,
              },
            })
          );
        }
      }
    }

    return documents;
  }

  /**
   * 移除 HTML 标签，提取纯文本（完整版，包含 script/style 移除）
   */
  private stripHtml(html: string): string {
    // 移除 script 和 style 标签及其内容
    let text = html.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      ''
    );
    text = text.replace(
      /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
      ''
    );

    return this.stripTags(text);
  }

  /**
   * 仅移除 HTML 标签并解码实体（轻量版，用于已清理过 script/style 的内容）
   */
  private stripTags(html: string): string {
    let text = html.replace(/<[^>]+>/g, ' ');
    text = this.decodeHtmlEntities(text);
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  /**
   * 解码 HTML 实体
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
  }

  /**
   * 动态导入 turndown 库
   */
  private static async importsTurndown() {
    try {
      const module = await import('turndown');
      // ESM: module.default 是构造函数; CJS (Jest ts-jest): module 本身是构造函数
      return (module as any).default ?? module;
    } catch (e) {
      HTMLLoader.logger.error('Failed to load turndown', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load turndown. Please install it with: npm install turndown'
      );
    }
  }

  /**
   * 动态导入 turndown-plugin-gfm 插件
   */
  private static async importGfmPlugin() {
    try {
      const gfmPlugin = await import('turndown-plugin-gfm');
      return gfmPlugin;
    } catch (e) {
      HTMLLoader.logger.error('Failed to load turndown-plugin-gfm', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load turndown-plugin-gfm. Please install it with: npm install turndown-plugin-gfm'
      );
    }
  }
}
