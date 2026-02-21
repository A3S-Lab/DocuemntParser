import { Logger } from '@nestjs/common';
import { Document } from '../models/document.model';
import { BufferLoader } from './base/buffer.loader';
import { LoaderOptions } from './base/base-loader';
import { MarkdownConverterParser } from './parsers/markdown-converter.parser';
import { Blob as BlobData } from './base/blob-parser';

/**
 * XLSX 加载器配置选项
 */
export interface XLSXLoaderOptions extends LoaderOptions {
  /**
   * 指定要加载的 Sheet 名称
   * 如果不指定，则加载所有 Sheet
   */
  sheet?: string;

  /**
   * 是否按行分割（仅在降级到 xlsx 库时有效）
   * - true: 每行返回一个 Document
   * - false: 每个 Sheet 返回一个 Document
   * @default false
   */
  splitRows?: boolean;

  /**
   * 指定源列名称（仅在 splitRows=true 时有效）
   */
  sourceColumn?: string;

  /**
   * 元数据列（仅在 splitRows=true 时有效）
   */
  metadataColumns?: string[];
}

/**
 * XLSX 加载器 - 处理 Excel 文件
 *
 * 自动降级策略：
 * - 优先: markitdown-ts 转换为 Markdown 表格（保留表格结构）
 * - 降级: xlsx 转换为 CSV 格式
 *
 * 主要依赖: npm install markitdown-ts
 * 降级依赖 (可选): npm install xlsx
 *
 * 支持模式：
 * 1. Markdown 表格（默认）：每个 Sheet 转换为 Markdown 表格
 * 2. CSV 格式（降级）：使用 xlsx 转换
 * 3. 按行切分：每行返回一个 Document（仅 CSV 模式）
 *
 * @example
 * ```typescript
 * // 加载 Excel（自动尝试 Markdown，失败则降级到 CSV）
 * const loader = new XLSXLoader('data.xlsx');
 * const docs = await loader.load();
 * // 返回: [Document(Markdown表格)] 或 [Document(CSV格式)]
 *
 * // 按行分割（仅在降级到 CSV 模式时生效）
 * const loader = new XLSXLoader('data.xlsx', {
 *   splitRows: true,
 *   sourceColumn: 'id',
 *   metadataColumns: ['date', 'author']
 * });
 * const docs = await loader.load();
 * // 返回: [Document(row1), Document(row2), ...]
 * ```
 */
export class XLSXLoader extends BufferLoader {
  protected static readonly logger = new Logger(XLSXLoader.name);
  private sheetName?: string;
  private splitRows: boolean;
  private sourceColumn?: string;
  private metadataColumns: string[];

  constructor(
    filePathOrBlob: string | Blob,
    options: XLSXLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.sheetName = options.sheet;
    this.splitRows = options.splitRows ?? false;
    this.sourceColumn = options.sourceColumn;
    this.metadataColumns = options.metadataColumns ?? [];
  }

  /**
   * 解析 Excel buffer 并返回文档数组
   *
   * 优先尝试 Markdown 转换，失败则自动降级到 CSV
   *
   * @param raw - Excel buffer
   * @param metadata - 文档元数据
   * @returns Promise that resolves with an array of Document instances
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    // splitRows 时直接走 xlsx 原生解析，保证按行分割
    if (this.splitRows) {
      return await this.parseWithXLSX(raw, metadata);
    }

    // 优先尝试 markitdown-ts 转换为 Markdown 表格
    try {
      return await this.parseWithMarkdown(raw, metadata);
    } catch (markdownError) {
      XLSXLoader.logger.warn('Markdown conversion failed for XLSX, falling back to CSV extraction', {
        error: markdownError instanceof Error ? markdownError.message : String(markdownError),
      });

      // 降级到 xlsx 库转换为 CSV
      return await this.parseWithXLSX(raw, metadata);
    }
  }

  /**
   * 使用 markitdown-ts 转换为 Markdown 表格
   */
  private async parseWithMarkdown(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const markdownParser = new MarkdownConverterParser({
      fileExtension: '.xlsx'
    });

    // 将 Buffer 转换为 BlobData 格式
    const blobData: BlobData = {
      data: raw,
      metadata,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    return markdownParser.parse(blobData);
  }

  /**
   * 使用 xlsx 库转换为 CSV
   */
  private async parseWithXLSX(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const XLSX = await XLSXLoader.importsXLSX();
    const workbook = XLSX.read(raw, { type: 'buffer' });

    const documents: Document[] = [];

    // 确定要处理的 Sheet
    const sheetsToProcess = this.sheetName
      ? [this.sheetName]
      : workbook.SheetNames;

    // 按 Sheet 处理
    for (const sheetName of sheetsToProcess) {
      if (!workbook.SheetNames.includes(sheetName)) {
        XLSXLoader.logger.warn(`Sheet "${sheetName}" not found in workbook`);
        continue;
      }

      const sheet = workbook.Sheets[sheetName];

      if (this.splitRows) {
        // 按行分割
        const sheetDocs = this.parseSheetByRows(XLSX, sheet, {
          ...metadata,
          sheet: sheetName,
        });
        documents.push(...sheetDocs);
      } else {
        // 整个 Sheet 作为一个 Document
        const csv = XLSX.utils.sheet_to_csv(sheet);
        documents.push(
          new Document({
            pageContent: csv,
            metadata: {
              ...metadata,
              sheet: sheetName,
              format: 'csv',
              originalFormat: 'xlsx',
              extractedBy: 'xlsx',
            },
          })
        );
      }
    }

    return documents;
  }

  /**
   * 按行解析 Sheet
   */
  private parseSheetByRows(
    XLSX: any,
    sheet: any,
    metadata: Document['metadata']
  ): Document[] {
    // 将 Sheet 转换为 JSON 数组
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return [];
    }

    const documents: Document[] = [];

    // 获取所有列名
    const headers = Object.keys(rows[0]);

    // 处理每一行
    rows.forEach((row: any, index: number) => {
      // 分离内容列和元数据列
      const contentColumns: string[] = [];
      const rowMetadata: Record<string, any> = { ...metadata };

      headers.forEach(header => {
        const value = row[header];

        if (this.metadataColumns.includes(header)) {
          // 元数据列
          rowMetadata[header] = value;
        } else if (header === this.sourceColumn) {
          // 源列
          rowMetadata.source = value;
        } else {
          // 内容列
          contentColumns.push(`${header}: ${value}`);
        }
      });

      // 构建 pageContent
      const pageContent = contentColumns.join('\n');

      documents.push(
        new Document({
          pageContent,
          metadata: {
            ...rowMetadata,
            format: 'csv',
            originalFormat: 'xlsx',
            extractedBy: 'xlsx',
            row: index + 2, // Excel 行号（从 1 开始，加上表头）
          },
        })
      );
    });

    return documents;
  }

  /**
   * 动态导入 xlsx 库
   */
  private static async importsXLSX() {
    try {
      const XLSX = await import('xlsx');
      return XLSX;
    } catch (e) {
      XLSXLoader.logger.error('Failed to load xlsx', { error: e instanceof Error ? e.message : String(e) });
      throw new Error(
        'Failed to load xlsx. Please install it with: npm install xlsx'
      );
    }
  }
}
