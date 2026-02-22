import { Logger } from '@nestjs/common';
import {
  IOCRService,
  IOCRResult,
  IOCRPageResult,
} from '../interfaces/ocr-service.interface';

/**
 * AI SDK OCR 服务配置
 */
export interface AiSdkOcrConfig {
  /** 模型名称 */
  modelName: string;
  /** 提供商名称 */
  providerName?: string;
  /** API Key */
  apiKey: string;
  /** API Base URL */
  baseUrl: string;
  /** 默认 OCR 提示词 */
  defaultPrompt?: string;
  /** 并发 OCR 请求数（默认 2） */
  concurrency?: number;
  /** 图片渲染 DPI（默认 200） */
  density?: number;
  /** 图片格式（默认 jpeg） */
  imageFormat?: 'jpeg' | 'png';
  /** JPEG 质量（默认 85） */
  imageQuality?: number;
  /** 图片宽度（默认 1700） */
  imageWidth?: number;
  /** 图片高度（默认 2200） */
  imageHeight?: number;
}

const DEFAULT_OCR_PROMPT =
  '请识别图片中的所有文字内容，保持原始格式和排版。如果包含表格请使用 HTML table 格式，如果包含数学公式请使用 LaTeX 格式。';

/**
 * 基于 AI SDK 的默认 OCR 服务实现
 *
 * 使用 `ai` + `@ai-sdk/openai-compatible` 调用视觉模型进行 OCR 识别。
 * 使用 `pdf-lib` 获取页数，`pdf2pic` 将每页渲染为图片后发送给视觉模型。
 *
 * 当外部未传递 ocrService 时，模块会自动使用此默认实现。
 *
 * 需要安装 peer dependencies:
 * ```bash
 * npm install ai @ai-sdk/openai-compatible pdf2pic pdf-lib
 * ```
 */
export class AiSdkOcrService implements IOCRService {
  private readonly logger = new Logger(AiSdkOcrService.name);
  private readonly defaultPrompt: string;
  private readonly concurrency: number;
  private readonly density: number;
  private readonly imageFormat: 'jpeg' | 'png';
  private readonly imageQuality: number;
  private readonly imageWidth: number;
  private readonly imageHeight: number;
  private model: any;
  private generateTextFn: any;

  constructor(private readonly config: AiSdkOcrConfig) {
    this.defaultPrompt = config.defaultPrompt || DEFAULT_OCR_PROMPT;
    this.concurrency = config.concurrency ?? 2;
    this.density = config.density ?? 200;
    this.imageFormat = config.imageFormat ?? 'jpeg';
    this.imageQuality = config.imageQuality ?? 85;
    this.imageWidth = config.imageWidth ?? 1700;
    this.imageHeight = config.imageHeight ?? 2200;
  }

  /**
   * 延迟加载 AI SDK 依赖
   */
  private async ensureModel(): Promise<void> {
    if (this.model) return;

    try {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      const { generateText } = await import('ai');

      this.model = createOpenAICompatible({
        baseURL: this.config.baseUrl,
        name: this.config.providerName || 'ocr-provider',
        apiKey: this.config.apiKey,
      }).chatModel(this.config.modelName);

      this.generateTextFn = generateText;
    } catch {
      throw new Error(
        '需要安装 ai 和 @ai-sdk/openai-compatible 依赖才能使用默认 OCR 服务。\n' +
        '请运行: npm install ai @ai-sdk/openai-compatible',
      );
    }
  }

  /**
   * 获取 PDF 页数（pdf-lib）
   */
  private async getPageCount(pdfBuffer: Buffer): Promise<number> {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      return pdfDoc.getPageCount();
    } catch {
      throw new Error(
        '需要安装 pdf-lib 依赖才能解析 PDF 页数。\n' +
        '请运行: npm install pdf-lib',
      );
    }
  }

  /**
   * 将 PDF 单页渲染为图片（pdf2pic）
   */
  private async convertPageToImage(pdfBuffer: Buffer, pageIndex: number): Promise<Buffer> {
    try {
      const { fromBuffer } = await import('pdf2pic');

      const converter = fromBuffer(pdfBuffer, {
        density: this.density,
        format: this.imageFormat,
        width: this.imageWidth,
        height: this.imageHeight,
        quality: this.imageQuality,
      });

      // pdf2pic 页码从 1 开始
      const result = await converter(pageIndex, { responseType: 'buffer' });

      if (!result?.buffer) {
        throw new Error(`pdf2pic 未返回第 ${pageIndex} 页的图片数据`);
      }

      return result.buffer as Buffer;
    } catch (error) {
      if (error instanceof Error && error.message.includes('pdf2pic')) {
        throw error;
      }
      throw new Error(
        '需要安装 pdf2pic 依赖才能将 PDF 转为图片。\n' +
        '请运行: npm install pdf2pic\n' +
        '注意: pdf2pic 依赖 GraphicsMagick，请确保系统已安装。',
      );
    }
  }

  /**
   * 对单张图片调用视觉模型 OCR
   */
  private async recognizePage(
    imageBuffer: Buffer,
    prompt: string,
    pageIndex: number,
    totalPages: number,
  ): Promise<string> {
    const { text } = await this.generateTextFn({
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', image: imageBuffer },
          {
            type: 'text',
            text: `${prompt}\n\n当前处理第 ${pageIndex}/${totalPages} 页。`,
          },
        ],
      }],
    });

    return text;
  }

  /**
   * 处理文档（OCR 识别）
   *
   * 流程：pdf-lib 获取页数 → pdf2pic 按页转图 → 视觉模型 OCR → 收集结果
   * 支持并发控制，避免同时发送过多请求
   */
  async processDocument(
    taskId: string,
    input: { pdfBuffer: Buffer },
    options?: {
      processOnlyPages?: number[];
      ocrPrompt?: string;
    },
    callbacks?: {
      onPageSuccess?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
      onPageFailed?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
    },
  ): Promise<IOCRResult> {
    await this.ensureModel();

    const prompt = options?.ocrPrompt || this.defaultPrompt;
    const totalPages = await this.getPageCount(input.pdfBuffer);

    const pagesToProcess = options?.processOnlyPages
      || Array.from({ length: totalPages }, (_, i) => i + 1);

    this.logger.log(`[${taskId}] 开始 OCR 处理`, {
      totalPages,
      pagesToProcess: pagesToProcess.length,
      concurrency: this.concurrency,
    });

    const results: IOCRPageResult[] = [];
    const queue = [...pagesToProcess];

    const processPage = async (pageIndex: number): Promise<void> => {
      const startTime = Date.now();

      try {
        // 1. PDF 页 → 图片
        const imageBuffer = await this.convertPageToImage(input.pdfBuffer, pageIndex);

        // 2. 图片 → OCR 文本
        const text = await this.recognizePage(imageBuffer, prompt, pageIndex, totalPages);

        const pageResult: IOCRPageResult = {
          pageIndex,
          status: 'success',
          text,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };

        results.push(pageResult);

        this.logger.debug(`[${taskId}] 第 ${pageIndex}/${totalPages} 页 OCR 完成`, {
          duration: pageResult.duration,
          textLength: text.length,
        });

        if (callbacks?.onPageSuccess) {
          await callbacks.onPageSuccess(taskId, pageResult);
        }
      } catch (error) {
        const pageResult: IOCRPageResult = {
          pageIndex,
          status: 'failed',
          duration: Date.now() - startTime,
          timestamp: Date.now(),
        };

        results.push(pageResult);

        this.logger.error(`[${taskId}] 第 ${pageIndex}/${totalPages} 页 OCR 失败`, {
          error: error instanceof Error ? error.message : String(error),
        });

        if (callbacks?.onPageFailed) {
          await callbacks.onPageFailed(taskId, pageResult);
        }
      }
    };

    // 并发控制：使用计数信号量 + 等待队列
    let activeCount = 0;
    const waitQueue: Array<() => void> = [];

    const waitForSlot = (): Promise<void> => {
      if (activeCount < this.concurrency) return Promise.resolve();
      return new Promise<void>(resolve => { waitQueue.push(resolve); });
    };

    const releaseSlot = (): void => {
      activeCount--;
      if (waitQueue.length > 0) {
        const resolve = waitQueue.shift()!;
        resolve();
      }
    };

    const tasks: Promise<void>[] = [];

    for (const pageIndex of queue) {
      await waitForSlot();
      activeCount++;

      const task = processPage(pageIndex).finally(releaseSlot);
      tasks.push(task);
    }

    // 等待所有任务完成
    await Promise.all(tasks);

    // 按页码排序
    results.sort((a, b) => a.pageIndex - b.pageIndex);

    // 合并全文
    const successTexts = results
      .filter(r => r.status === 'success' && r.text)
      .map(r => r.text!);
    const fullText = successTexts.length > 0 ? successTexts.join('\n\n') : undefined;

    this.logger.log(`[${taskId}] OCR 处理完成`, {
      totalPages,
      success: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
    });

    return { totalPages, results, fullText };
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<void> {
    await this.ensureModel();
  }
}
