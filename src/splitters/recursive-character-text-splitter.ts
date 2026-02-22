import { TextSplitter, TextSplitterParams } from './text-splitter';

/**
 * 支持的语言类型
 */
export const SupportedTextSplitterLanguages = [
  'cpp',
  'go',
  'java',
  'js',
  'php',
  'proto',
  'python',
  'rst',
  'ruby',
  'rust',
  'scala',
  'swift',
  'markdown',
  'latex',
  'html',
  'sol',
] as const;

export type SupportedTextSplitterLanguage =
  (typeof SupportedTextSplitterLanguages)[number];

/**
 * RecursiveCharacterTextSplitter 配置参数
 */
export interface RecursiveCharacterTextSplitterParams extends TextSplitterParams {
  /**
   * 分隔符数组，按优先级排序
   * @default ["\n\n", "\n", " ", ""]
   */
  separators?: string[];
}

/**
 * 递归字符文本分割器
 *
 * 递归地使用多个分隔符分割文本，优先使用较大的分隔符
 *
 * @example
 * ```typescript
 * const splitter = new RecursiveCharacterTextSplitter({
 *   chunkSize: 1000,
 *   chunkOverlap: 200
 * });
 *
 * const chunks = await splitter.splitText(text);
 * ```
 */
export class RecursiveCharacterTextSplitter extends TextSplitter {
  private separators: string[];

  constructor(params: RecursiveCharacterTextSplitterParams = {}) {
    super(params);
    this.separators = params.separators ?? ['\n\n', '\n', ' ', ''];
    this.keepSeparator = params.keepSeparator ?? true;
  }

  /**
   * 获取指定语言的分隔符
   *
   * @param language 语言类型
   * @returns 分隔符数组
   */
  static getSeparatorsForLanguage(language: SupportedTextSplitterLanguage): string[] {
    if (language === 'cpp') {
      return [
        '\nclass ',
        '\nvoid ',
        '\nint ',
        '\nfloat ',
        '\ndouble ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\nswitch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'go') {
      return [
        '\nfunc ',
        '\nvar ',
        '\nconst ',
        '\ntype ',
        '\nif ',
        '\nfor ',
        '\nswitch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'java') {
      return [
        '\nclass ',
        '\npublic ',
        '\nprotected ',
        '\nprivate ',
        '\nstatic ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\nswitch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'js') {
      return [
        '\nfunction ',
        '\nconst ',
        '\nlet ',
        '\nvar ',
        '\nclass ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\nswitch ',
        '\ncase ',
        '\ndefault ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'php') {
      return [
        '\nfunction ',
        '\nclass ',
        '\nif ',
        '\nforeach ',
        '\nwhile ',
        '\ndo ',
        '\nswitch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'proto') {
      return [
        '\nmessage ',
        '\nservice ',
        '\nenum ',
        '\noption ',
        '\nimport ',
        '\nsyntax ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'python') {
      return [
        '\nclass ',
        '\ndef ',
        '\n\tdef ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'rst') {
      return [
        '\n===\n',
        '\n---\n',
        '\n***\n',
        '\n.. ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'ruby') {
      return [
        '\ndef ',
        '\nclass ',
        '\nif ',
        '\nunless ',
        '\nwhile ',
        '\nfor ',
        '\ndo ',
        '\nbegin ',
        '\nrescue ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'rust') {
      return [
        '\nfn ',
        '\nconst ',
        '\nlet ',
        '\nif ',
        '\nwhile ',
        '\nfor ',
        '\nloop ',
        '\nmatch ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'scala') {
      return [
        '\nclass ',
        '\nobject ',
        '\ndef ',
        '\nval ',
        '\nvar ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\nmatch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'swift') {
      return [
        '\nfunc ',
        '\nclass ',
        '\nstruct ',
        '\nenum ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\ndo ',
        '\nswitch ',
        '\ncase ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'markdown') {
      return [
        '\n## ',
        '\n### ',
        '\n#### ',
        '\n##### ',
        '\n###### ',
        '```\n\n',
        '\n\n***\n\n',
        '\n\n---\n\n',
        '\n\n___\n\n',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'latex') {
      return [
        '\n\\chapter{',
        '\n\\section{',
        '\n\\subsection{',
        '\n\\subsubsection{',
        '\n\\begin{enumerate}',
        '\n\\begin{itemize}',
        '\n\\begin{description}',
        '\n\\begin{list}',
        '\n\\begin{quote}',
        '\n\\begin{quotation}',
        '\n\\begin{verse}',
        '\n\\begin{verbatim}',
        '\n\\begin{align}',
        '$$',
        '$',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else if (language === 'html') {
      return [
        '<body>',
        '<div>',
        '<p>',
        '<br>',
        '<li>',
        '<h1>',
        '<h2>',
        '<h3>',
        '<h4>',
        '<h5>',
        '<h6>',
        '<span>',
        '<table>',
        '<tr>',
        '<td>',
        '<th>',
        '<ul>',
        '<ol>',
        '<header>',
        '<footer>',
        '<nav>',
        '<head>',
        '<style>',
        '<script>',
        '<meta>',
        '<title>',
        ' ',
        '',
      ];
    } else if (language === 'sol') {
      return [
        '\npragma ',
        '\nusing ',
        '\ncontract ',
        '\ninterface ',
        '\nlibrary ',
        '\nconstructor ',
        '\ntype ',
        '\nfunction ',
        '\nevent ',
        '\nmodifier ',
        '\nerror ',
        '\nstruct ',
        '\nenum ',
        '\nif ',
        '\nfor ',
        '\nwhile ',
        '\ndo while ',
        '\nassembly ',
        '\n\n',
        '\n',
        ' ',
        '',
      ];
    } else {
      throw new Error(`Language ${language} is not supported.`);
    }
  }

  /**
   * 分割文本
   */
  async splitText(text: string): Promise<string[]> {
    return this._splitText(text, this.separators);
  }

  /**
   * 递归分割文本
   */
  private async _splitText(text: string, separators: string[]): Promise<string[]> {
    const finalChunks: string[] = [];

    // 选择合适的分隔符
    let separator: string = separators[separators.length - 1];
    let newSeparators: string[] | undefined;

    for (let i = 0; i < separators.length; i++) {
      const s = separators[i];
      if (s === '') {
        separator = s;
        break;
      }
      if (text.includes(s)) {
        separator = s;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    // 使用选定的分隔符分割文本
    const splits = this.splitOnSeparator(text, separator);

    // 合并和递归分割
    let goodSplits: string[] = [];
    const _separator = this.keepSeparator ? '' : separator;

    for (const s of splits) {
      if ((await this.lengthFunction(s)) < this.chunkSize) {
        goodSplits.push(s);
      } else {
        if (goodSplits.length) {
          const mergedText = await this.mergeSplits(goodSplits, _separator);
          finalChunks.push(...mergedText);
          goodSplits = [];
        }

        if (!newSeparators) {
          finalChunks.push(s);
        } else {
          const otherInfo = await this._splitText(s, newSeparators);
          finalChunks.push(...otherInfo);
        }
      }
    }

    if (goodSplits.length) {
      const mergedText = await this.mergeSplits(goodSplits, _separator);
      finalChunks.push(...mergedText);
    }

    return finalChunks;
  }
}
