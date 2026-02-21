import { Logger } from '@nestjs/common';
import * as Papa from 'papaparse';
import { Document } from '../models/document.model';
import { BufferLoader, BufferLoaderOptions } from './base/buffer.loader';

/**
 * CSV 加载器配置选项
 */
export interface CSVLoaderOptions extends BufferLoaderOptions {
  /**
   * 是否按行分割（仅在 useMarkdown=false 时有效）
   * - true: 每行返回一个 Document（LangChain 标准）
   * - false: 整个文件返回一个 Document
   * @default true
   */
  splitRows?: boolean;

  /**
   * 指定源列名称（仅在 splitRows=true 时有效）
   * 该列的值会被添加到 metadata.source
   */
  sourceColumn?: string;

  /**
   * 元数据列（仅在 splitRows=true 时有效）
   * 这些列的值会被添加到 metadata，而不是 pageContent
   */
  metadataColumns?: string[];

  /**
   * CSV 分隔符
   * @default ','
   */
  separator?: string;

  /**
   * 是否转换为 Markdown 表格（保留表格结构）
   * - true: 转换为 Markdown 表格格式（推荐）
   * - false: 保持 CSV 格式或按行分割
   * @default true
   */
  useMarkdown?: boolean;
}

/**
 * CSV 加载器 - 处理 CSV 文件
 *
 * 使用 papaparse 进行 CSV 解析，正确处理引号、换行、转义等边��情况
 *
 * 支持模式：
 * 1. Markdown 表格（默认）：CSV 数据转换为 Markdown 表格
 * 2. 按行分割：每行返回一个 Document
 * 3. 完整 CSV：整个文件作为一个 Document
 *
 * @example
 * ```typescript
 * // 转换为 Markdown 表格（推荐）
 * const loader = new CSVLoader('data.csv');
 * const docs = await loader.load();
 *
 * // 按行分割（传统方式）
 * const loader = new CSVLoader('data.csv', {
 *   useMarkdown: false,
 *   splitRows: true
 * });
 *
 * // 指定源列和元数据列
 * const loader = new CSVLoader('data.csv', {
 *   useMarkdown: false,
 *   splitRows: true,
 *   sourceColumn: 'id',
 *   metadataColumns: ['author', 'date']
 * });
 * ```
 */
export class CSVLoader extends BufferLoader {
  private readonly logger = new Logger(CSVLoader.name);
  private splitRows: boolean;
  private sourceColumn?: string;
  private metadataColumns: string[];
  private separator: string;
  private useMarkdown: boolean;

  constructor(
    filePathOrBlob: string | Blob,
    options: CSVLoaderOptions = {}
  ) {
    super(filePathOrBlob, options);
    this.splitRows = options.splitRows ?? true;
    this.sourceColumn = options.sourceColumn;
    this.metadataColumns = options.metadataColumns ?? [];
    this.separator = options.separator ?? ',';
    this.useMarkdown = options.useMarkdown ?? true;
  }

  /**
   * 解析 CSV buffer 并返回文档数组
   */
  public async parse(
    raw: Buffer,
    metadata: Document['metadata']
  ): Promise<Document[]> {
    const text = raw.toString(this.encoding);

    // splitRows 优先级高于 useMarkdown：需要按行分割时走原生解析
    if (this.useMarkdown && !this.splitRows) {
      return this.parseAsMarkdownTable(text, metadata);
    }

    if (!this.splitRows) {
      return [
        new Document({
          pageContent: text,
          metadata: {
            ...metadata,
            format: 'csv',
            originalFormat: 'csv',
          },
        }),
      ];
    }

    return this.parseRows(text, metadata);
  }

  /**
   * 使用 papaparse 解析 CSV 文本
   */
  private parseCSV(text: string): { headers: string[]; rows: string[][] } {
    const result = Papa.parse(text, {
      delimiter: this.separator,
      skipEmptyLines: true,
    });

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        this.logger.warn(`CSV parse warning at row ${err.row}: ${err.message}`);
      }
    }

    const data = result.data as string[][];
    if (data.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = data[0];
    const rows = data.slice(1);
    return { headers, rows };
  }

  /**
   * 将 CSV 转换为 Markdown 表格
   */
  private parseAsMarkdownTable(
    text: string,
    metadata: Document['metadata']
  ): Document[] {
    const { headers, rows } = this.parseCSV(text);

    if (headers.length === 0) {
      return [];
    }

    const markdownTable = this.buildMarkdownTable(headers, rows);

    return [
      new Document({
        pageContent: markdownTable,
        metadata: {
          ...metadata,
          format: 'markdown',
          originalFormat: 'csv',
          rows: rows.length,
          columns: headers.length,
        },
      }),
    ];
  }

  /**
   * 构建 Markdown 表格字符串
   */
  private buildMarkdownTable(headers: string[], rows: string[][]): string {
    const columnWidths = headers.map((header, colIndex) => {
      if (rows.length === 0) {
        return header.length;
      }
      const maxDataWidth = Math.max(
        ...rows.map(row => (row[colIndex] || '').length)
      );
      return Math.max(header.length, maxDataWidth);
    });

    const headerRow = '| ' + headers.map((h, i) =>
      h.padEnd(columnWidths[i])
    ).join(' | ') + ' |';

    const separatorRow = '| ' + columnWidths.map(w =>
      '-'.repeat(w)
    ).join(' | ') + ' |';

    const dataRows = rows.map(row =>
      '| ' + row.map((cell, i) =>
        (cell || '').padEnd(columnWidths[i])
      ).join(' | ') + ' |'
    );

    return [headerRow, separatorRow, ...dataRows].join('\n');
  }

  /**
   * 按行解析 CSV
   */
  private parseRows(text: string, metadata: Document['metadata']): Document[] {
    const { headers, rows } = this.parseCSV(text);

    if (headers.length === 0) {
      return [];
    }

    const documents: Document[] = [];

    for (let i = 0; i < rows.length; i++) {
      const values = rows[i];

      if (values.length !== headers.length) {
        this.logger.warn(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
        continue;
      }

      // 构建行对象
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });

      // 分离内容列和元数据列
      const contentColumns: string[] = [];
      const rowMetadata: Record<string, any> = { ...metadata };

      headers.forEach(header => {
        if (this.metadataColumns.includes(header)) {
          rowMetadata[header] = row[header];
        } else if (header === this.sourceColumn) {
          rowMetadata.source = row[header];
        } else {
          contentColumns.push(`${header}: ${row[header]}`);
        }
      });

      const pageContent = contentColumns.join('\n');

      documents.push(
        new Document({
          pageContent,
          metadata: {
            ...rowMetadata,
            format: 'csv',
            originalFormat: 'csv',
            row: i + 1,
          },
        })
      );
    }

    return documents;
  }
}
