import { Document } from '../models/document.model';

/**
 * 标题分割配置
 */
export interface HeaderToSplitOn {
  /**
   * 标题标记（如 "#", "##", "###"）
   */
  marker: string;

  /**
   * 标题名称（用于元数据）
   */
  name: string;
}

/**
 * 行类型
 */
interface LineType {
  content: string;
  metadata: Record<string, string>;
}

/**
 * 标题类型
 */
interface HeaderType {
  level: number;
  name: string;
  data: string;
}

/**
 * MarkdownHeaderTextSplitter 配置参数
 */
export interface MarkdownHeaderTextSplitterParams {
  /**
   * 要分割的标题级别
   * @example [{ marker: '#', name: 'Header 1' }, { marker: '##', name: 'Header 2' }]
   */
  headersToSplitOn: HeaderToSplitOn[];

  /**
   * 是否返回每一行（而不是合并的块）
   * @default false
   */
  returnEachLine?: boolean;

  /**
   * 是否从内容中移除标题标记
   * @default true
   */
  stripHeaders?: boolean;
}

/**
 * Markdown 标题文本分割器
 *
 * 根据 Markdown 标题层级分割文档，保留文档结构和上下文
 *
 * @example
 * ```typescript
 * const splitter = new MarkdownHeaderTextSplitter({
 *   headersToSplitOn: [
 *     { marker: '#', name: 'Header 1' },
 *     { marker: '##', name: 'Header 2' },
 *     { marker: '###', name: 'Header 3' }
 *   ]
 * });
 *
 * const docs = await splitter.splitText(markdownText);
 * ```
 */
export class MarkdownHeaderTextSplitter {
  private headersToSplitOn: HeaderToSplitOn[];
  private returnEachLine: boolean;
  private stripHeaders: boolean;

  constructor(params: MarkdownHeaderTextSplitterParams) {
    // 拷贝数组避免修改调用方的原始数据
    this.headersToSplitOn = [...params.headersToSplitOn];
    this.returnEachLine = params.returnEachLine ?? false;
    this.stripHeaders = params.stripHeaders ?? true;

    // 按标记长度降序排序（确保先匹配更长的标记）
    this.headersToSplitOn.sort((a, b) => b.marker.length - a.marker.length);
  }

  /**
   * 分割文本
   */
  async splitText(text: string): Promise<Document[]> {
    const lines = text.split('\n');
    const linesWithMetadata: LineType[] = [];

    let currentContent: string[] = [];
    let currentMetadata: Record<string, string> = {};
    const headerStack: HeaderType[] = [];
    const initialMetadata: Record<string, string> = {};

    let inCodeBlock = false;
    let openingFence = '';

    for (const line of lines) {
      let strippedLine = line.trim();
      // 移除不可打印的控制字符（保留所有合法 Unicode 文本）
      strippedLine = strippedLine.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

      // 处理代码块（排除行内代码）
      // 开启围栏：以 ``` 或 ~~~ 开头，且该标记在行内只出现一次（排除 ```code``` 这种行内代码）
      // 关闭围栏：行内容恰好是围栏标记本身（可带尾部空白）
      if (!inCodeBlock) {
        if (strippedLine.startsWith('```') && strippedLine.split('```').length === 2) {
          inCodeBlock = true;
          openingFence = '```';
        } else if (strippedLine.startsWith('~~~') && strippedLine.split('~~~').length === 2) {
          inCodeBlock = true;
          openingFence = '~~~';
        }
      } else if (strippedLine === openingFence) {
        inCodeBlock = false;
        openingFence = '';
      }

      if (inCodeBlock) {
        currentContent.push(strippedLine);
        continue;
      }

      // 检查是否为标题行
      let isHeader = false;
      for (const { marker, name } of this.headersToSplitOn) {
        // 标题必须：1) 以标记开头，2) 标记后是空格或行尾
        const isStandardHeader =
          strippedLine.startsWith(marker) &&
          (strippedLine.length === marker.length || strippedLine[marker.length] === ' ');

        if (isStandardHeader && name) {
          isHeader = true;

          // 获取当前标题级别（通过 # 的数量）
          const currentHeaderLevel = marker.split('#').length - 1;

          // 弹出栈中相同或更低级别的标题（遇到新的同级或上级标题）
          while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= currentHeaderLevel) {
            const poppedHeader = headerStack.pop()!;
            if (poppedHeader.name in initialMetadata) {
              delete initialMetadata[poppedHeader.name];
            }
          }

          // 提取标题文本（去掉标记和前后空格）
          const headerText = strippedLine.substring(marker.length).trim();

          // 将当前标题压入栈
          const header: HeaderType = {
            level: currentHeaderLevel,
            name,
            data: headerText,
          };
          headerStack.push(header);
          initialMetadata[name] = header.data;

          // 保存之前累积的内容（如果有）
          if (currentContent.length > 0) {
            linesWithMetadata.push({
              content: currentContent.join('\n'),
              metadata: { ...currentMetadata },
            });
            currentContent = [];
          }

          // 如果不移除标题，将标题行添加到内容中
          if (!this.stripHeaders) {
            currentContent.push(strippedLine);
          }

          break;
        }
      }

      if (!isHeader) {
        if (strippedLine) {
          currentContent.push(strippedLine);
        } else if (currentContent.length > 0) {
          linesWithMetadata.push({
            content: currentContent.join('\n'),
            metadata: { ...currentMetadata },
          });
          currentContent = [];
        }
      }

      currentMetadata = { ...initialMetadata };
    }

    // 保存最后的内容
    if (currentContent.length > 0) {
      linesWithMetadata.push({
        content: currentContent.join('\n'),
        metadata: currentMetadata,
      });
    }

    // 聚合或返回每一行
    if (!this.returnEachLine) {
      return this.aggregateLinesToChunks(linesWithMetadata);
    }

    return linesWithMetadata.map(
      (chunk) =>
        new Document({
          pageContent: chunk.content,
          metadata: chunk.metadata,
        })
    );
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
   * 聚合具有相同元数据的行
   */
  private aggregateLinesToChunks(lines: LineType[]): Document[] {
    const aggregatedChunks: LineType[] = [];

    for (const line of lines) {
      if (
        aggregatedChunks.length > 0 &&
        this.isSameMetadata(aggregatedChunks[aggregatedChunks.length - 1].metadata, line.metadata)
      ) {
        // 如果最后一个块的元数据与当前行相同，合并内容
        aggregatedChunks[aggregatedChunks.length - 1].content += '  \n' + line.content;
      } else if (
        aggregatedChunks.length > 0 &&
        !this.isSameMetadata(aggregatedChunks[aggregatedChunks.length - 1].metadata, line.metadata) &&
        Object.keys(aggregatedChunks[aggregatedChunks.length - 1].metadata).length <
          Object.keys(line.metadata).length &&
        aggregatedChunks[aggregatedChunks.length - 1].content.split('\n').slice(-1)[0][0] === '#' &&
        !this.stripHeaders
      ) {
        // 如果最后一个块是标题且不移除标题，合并内容并更新元数据
        aggregatedChunks[aggregatedChunks.length - 1].content += '  \n' + line.content;
        aggregatedChunks[aggregatedChunks.length - 1].metadata = line.metadata;
      } else {
        // 否则添加新块
        aggregatedChunks.push(line);
      }
    }

    return aggregatedChunks.map(
      (chunk) =>
        new Document({
          pageContent: chunk.content,
          metadata: chunk.metadata,
        })
    );
  }

  /**
   * 比较两个元数据对象是否相同
   */
  private isSameMetadata(meta1: Record<string, string>, meta2: Record<string, string>): boolean {
    const keys1 = Object.keys(meta1);
    const keys2 = Object.keys(meta2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1) {
      if (meta1[key] !== meta2[key]) {
        return false;
      }
    }

    return true;
  }
}
