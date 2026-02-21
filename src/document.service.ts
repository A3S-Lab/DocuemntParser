import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Document } from './models/document.model';
import { DOCUMENT_MODULE_OPTIONS } from './document.module-definition';
import { DocumentModuleOptions } from './document-module-options.interface';
import { BaseDocumentLoader } from './loaders/base/base-loader';
import { MarkdownLoader } from './loaders/markdown.loader';
import { PDFLoader } from './loaders/pdf.loader';
import { TextLoader } from './loaders/text.loader';
import { HTMLLoader } from './loaders/html.loader';
import { DocxLoader } from './loaders/docx.loader';
import { XLSXLoader } from './loaders/xlsx.loader';
import { JSONLoader } from './loaders/json.loader';
import { CSVLoader } from './loaders/csv.loader';
import { EXTENSION_TO_MIME } from './loaders/constants/mime-types';
import { CacheKeyGenerator } from './common/cache/document-cache.service';
import { IDocumentCacheService, CACHE_SERVICE_TOKEN } from './common/cache/cache.interface';
import { PerformanceMonitorService } from './common/monitoring/performance-monitor.service';
import { RateLimiterService } from './common/resilience/rate-limiter.service';
import { CircuitBreakerService } from './common/resilience/circuit-breaker.service';
import { FileValidatorService } from './common/validation/file-validator.service';
import { DocumentValidationError } from './common/errors/document.errors';

/**
 * Document 服务
 *
 * 提供文档加载和处理的核心功能，集成缓存、限流、熔断和性能监控
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @Inject(DOCUMENT_MODULE_OPTIONS)
    private readonly options: DocumentModuleOptions,
    @Optional() @Inject(CACHE_SERVICE_TOKEN) private readonly cacheService?: IDocumentCacheService,
    @Optional() private readonly performanceMonitor?: PerformanceMonitorService,
    @Optional() private readonly fileValidator?: FileValidatorService,
    @Optional() private readonly rateLimiter?: RateLimiterService,
    @Optional() private readonly circuitBreaker?: CircuitBreakerService,
  ) {
    this.logger.log('DocumentService initialized', {
      cacheEnabled: !!this.cacheService,
      monitoringEnabled: !!this.performanceMonitor,
      fileValidationEnabled: !!this.fileValidator,
      rateLimitEnabled: !!(this.rateLimiter && this.options.rateLimit),
      circuitBreakerEnabled: !!(this.circuitBreaker && this.options.circuitBreaker),
      processorsCount: this.options.processors?.length || 0,
    });
  }

  /** 获取模块配置 */
  getOptions(): DocumentModuleOptions {
    return this.options;
  }

  /**
   * 完整流程：加载文档并应用处理器管道
   */
  async loadAndProcess(loader: BaseDocumentLoader): Promise<Document[]> {
    const startTime = Date.now();
    const loaderName = loader.constructor.name;

    try {
      this.logger.debug(`开始加载文档`, { loader: loaderName });

      const docs = await loader.load();
      this.logger.debug(`文档加载完成`, {
        loader: loaderName,
        documentCount: docs.length,
        duration: Date.now() - startTime,
      });

      const processed = await this.processDocuments(docs);

      this.logger.log(`文档处理完成`, {
        loader: loaderName,
        inputCount: docs.length,
        outputCount: processed.length,
        duration: Date.now() - startTime,
      });

      return processed;
    } catch (error) {
      this.logger.error(`文档加载处理失败`, {
        loader: loaderName,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * 处理 Buffer（从 MinIO 等对象存储下载的文件）
   *
   * 集成限流、熔断、缓存和性能监控
   */
  async processBuffer(buffer: Buffer, filename: string): Promise<Document[]> {
    // 限流检查
    if (this.rateLimiter && this.options.rateLimit) {
      const result = await this.rateLimiter.checkLimit('documentService', {
        maxRequests: this.options.rateLimit.maxRequests,
        windowMs: this.options.rateLimit.windowMs,
        algorithm: this.options.rateLimit.algorithm as any,
      });
      if (!result.allowed) {
        throw new DocumentValidationError('请求过于频繁，请稍后重试', {
          filename,
          code: 'RATE_LIMITED',
          retryAfter: result.retryAfter,
        });
      }
    }

    const operation = 'processBuffer';

    // 熔断器包装
    const execute = () => this._processBufferInternal(buffer, filename);

    if (this.circuitBreaker && this.options.circuitBreaker) {
      const wrappedFn = () =>
        this.circuitBreaker!.execute('documentService', execute, this.options.circuitBreaker);

      // 性能监控包装
      if (this.performanceMonitor) {
        return this.performanceMonitor.recordOperation(operation, wrappedFn, {
          filename,
          size: buffer.length,
        });
      }
      return wrappedFn();
    }

    // 仅性能监控
    if (this.performanceMonitor) {
      return this.performanceMonitor.recordOperation(operation, execute, {
        filename,
        size: buffer.length,
      });
    }

    return execute();
  }

  /** 内部 Buffer 处理方法 */
  private async _processBufferInternal(buffer: Buffer, filename: string): Promise<Document[]> {
    const startTime = Date.now();

    try {
      this.logger.debug(`开始处理 Buffer`, { filename, size: buffer.length });

      // 步骤 0: 文件验证（始终使用默认规则，用户配置可覆盖）
      if (this.fileValidator) {
        const validation = this.fileValidator.validate(buffer, filename, this.options.fileValidation);
        if (!validation.valid) {
          throw new DocumentValidationError(
            `文件验证失败: ${validation.errors?.join('; ')}`,
            { filename, errors: validation.errors },
          );
        }
      }

      // 预计算缓存 key（避免对大文件重复 SHA-256）
      const cacheKey = (this.cacheService && this.options.enableCache)
        ? CacheKeyGenerator.forBuffer(buffer, filename)
        : null;

      // 步骤 1: 检查缓存
      if (cacheKey && this.cacheService) {
        const cached = await Promise.resolve(this.cacheService.get(cacheKey));
        if (cached) {
          this.logger.debug(`从缓存返回结果`, { filename });
          return cached;
        }
      }

      // 步骤 2: 从 Buffer 创建 Blob（使用 ArrayBuffer 视图避免额外内存拷贝）
      const blob = new Blob(
        [new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)],
        { type: this.getMimeType(filename) },
      );

      // 步骤 3: 根据文件扩展名自动选择 Loader
      const loader = this.getLoaderForFile(blob, filename);

      // 步骤 4: 加载并应用处理器管道
      const processedDocs = await this.loadAndProcess(loader);

      // 步骤 5: 添加文件名到元数据
      const result = processedDocs.map(
        doc =>
          new Document({
            pageContent: doc.pageContent,
            metadata: { ...doc.metadata, source: filename },
          }),
      );

      // 步骤 6: 缓存结果（复用预计算的 key）
      if (cacheKey && this.cacheService) {
        await Promise.resolve(this.cacheService.set(cacheKey, result, this.options.cacheTTL));
      }

      this.logger.log(`Buffer 处理完成`, {
        filename,
        size: buffer.length,
        documentCount: result.length,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.logger.error(`Buffer 处理失败`, {
        filename,
        size: buffer.length,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * 批量处理多个 Buffer
   */
  async processBuffers(
    files: Array<{ buffer: Buffer; filename: string }>,
    options?: { concurrency?: number; continueOnError?: boolean },
  ): Promise<Document[]> {
    const startTime = Date.now();
    const concurrency = options?.concurrency ?? this.options.batchProcessing?.concurrency ?? 5;
    const continueOnError =
      options?.continueOnError ?? this.options.batchProcessing?.continueOnError ?? true;

    try {
      this.logger.debug(`开始批量处理 Buffer`, { fileCount: files.length, concurrency, continueOnError });

      const allDocs: Document[] = [];
      const errors: Array<{ filename: string; error: string }> = [];

      for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
          batch.map(file => this.processBuffer(file.buffer, file.filename)),
        );

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          if (result.status === 'fulfilled') {
            allDocs.push(...result.value);
          } else {
            const failedFile = batch[j];
            const errorMsg =
              result.reason instanceof Error ? result.reason.message : String(result.reason);
            this.logger.error(`文件处理失败: ${failedFile.filename}`, { error: errorMsg });
            errors.push({ filename: failedFile.filename, error: errorMsg });
            if (!continueOnError) {
              throw result.reason;
            }
          }
        }
      }

      this.logger.log(`批量 Buffer 处理完成`, {
        fileCount: files.length,
        documentCount: allDocs.length,
        failedCount: errors.length,
        concurrency,
        duration: Date.now() - startTime,
      });

      return allDocs;
    } catch (error) {
      this.logger.error(`批量 Buffer 处理失败`, {
        fileCount: files.length,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * 流式处理多个 Buffer
   */
  async *streamProcessBuffers(
    files: Array<{ buffer: Buffer; filename: string }>,
  ): AsyncGenerator<Document> {
    for (const file of files) {
      const docs = await this.processBuffer(file.buffer, file.filename);
      for (const doc of docs) {
        yield doc;
      }
    }
  }

  /**
   * 流式处理：边加载边处理
   */
  async *streamLoadAndProcess(loader: BaseDocumentLoader): AsyncGenerator<Document> {
    for await (const doc of loader.lazyLoad()) {
      const processed = await this.processDocuments([doc]);
      for (const processedDoc of processed) {
        yield processedDoc;
      }
    }
  }

  /**
   * 处理文档（应用处理器管道）
   */
  async processDocuments(documents: Document[]): Promise<Document[]> {
    if (!this.options.processors || this.options.processors.length === 0) {
      return documents;
    }

    let processed = documents;
    for (const processor of this.options.processors) {
      const processorName = processor.getName();
      const startTime = Date.now();

      this.logger.debug(`应用处理器: ${processorName}`, { inputCount: processed.length });
      processed = await processor.process(processed);
      this.logger.debug(`处理器完成: ${processorName}`, {
        outputCount: processed.length,
        duration: Date.now() - startTime,
      });
    }

    return processed;
  }

  /** 增强文档元数据 */
  enhanceMetadata(document: Document): Document {
    if (!this.options.metadataEnhancer) {
      return document;
    }
    return this.options.metadataEnhancer(document);
  }

  /** 批量增强文档元数据 */
  enhanceMetadataBatch(documents: Document[]): Document[] {
    if (!this.options.metadataEnhancer) {
      return documents;
    }
    return documents.map(doc => this.options.metadataEnhancer!(doc));
  }

  /** 根据文件扩展名自动选择对应的 Loader */
  private getLoaderForFile(blob: Blob, filename: string): BaseDocumentLoader {
    const ext = filename.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'md':
      case 'markdown':
        return new MarkdownLoader(blob);
      case 'pdf':
        return new PDFLoader(blob, {
          autoDetectScanned: this.options.autoDetectScannedPdf,
          scannedPdfOptions: {
            ocrService: this.options.ocrService,
            ocrPrompt: this.options.defaultOcrPrompt,
          },
        });
      case 'docx':
        return new DocxLoader(blob);
      case 'doc':
        return new DocxLoader(blob, { type: 'doc' });
      case 'xlsx':
      case 'xls':
        return new XLSXLoader(blob);
      case 'html':
      case 'htm':
        return new HTMLLoader(blob);
      case 'json':
        return new JSONLoader(blob);
      case 'csv':
        return new CSVLoader(blob);
      case 'txt':
      case 'text':
      default:
        return new TextLoader(blob);
    }
  }

  /** 根据文件名获取 MIME 类型 */
  private getMimeType(filename: string): string {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1 || dotIndex === filename.length - 1) {
      return 'application/octet-stream';
    }
    const ext = filename.slice(dotIndex).toLowerCase();
    return EXTENSION_TO_MIME[ext] || 'application/octet-stream';
  }
}
