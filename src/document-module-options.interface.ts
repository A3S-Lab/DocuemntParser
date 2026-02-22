import { IDocumentProcessor } from './common/interfaces/processor.interface';
import { Document } from './models/document.model';
import { IRedisClient } from './common/interfaces/redis-client.interface';
import { IOCRService } from './common/interfaces/ocr-service.interface';
import { IEmbeddingService } from './common/interfaces/embedding-service.interface';

/**
 * AI 模型配置（用于内置 OCR / Embedding 默认实现）
 */
export interface AiModelConfig {
  /** 模型名称 */
  modelName: string;
  /** 提供商名称（可选） */
  providerName?: string;
  /** API Key */
  apiKey: string;
  /** API Base URL */
  baseUrl: string;
}

/**
 * Document 模块配置选项
 */
export interface DocumentModuleOptions {
  /**
   * 是否启用缓存
   * @default false
   */
  enableCache?: boolean;

  /**
   * 缓存过期时间（毫秒）
   * @default 3600000 (1小时)
   */
  cacheTTL?: number;

  /**
   * 缓存策略
   * - 'memory': 仅内存缓存（默认）
   * - 'multi-level': 多级缓存（L1 内存 + L2 Redis，需提供 redis 客户端）
   * @default 'memory'
   */
  cacheStrategy?: 'memory' | 'multi-level';

  /**
   * 多级缓存配置
   */
  multiLevelCache?: {
    /** L1 缓存 TTL（毫秒） */
    l1TTL?: number;
    /** L2 缓存 TTL（毫秒） */
    l2TTL?: number;
    /** L1 缓存最大条目数 */
    l1MaxSize?: number;
  };

  /**
   * 文档处理器管道
   *
   * 处理器会按顺序应用到文档上
   *
   * @example
   * ```typescript
   * DocumentModule.register({
   *   processors: [
   *     new TextCleanerProcessor(),
   *     new MetadataEnricherProcessor()
   *   ]
   * })
   * ```
   */
  processors?: IDocumentProcessor[];

  /**
   * 元数据增强函数
   *
   * 用于在文档加载后自动增强元数据
   *
   * @example
   * ```typescript
   * DocumentModule.register({
   *   metadataEnhancer: (doc) => ({
   *     ...doc,
   *     metadata: {
   *       ...doc.metadata,
   *       processedAt: new Date().toISOString()
   *     }
   *   })
   * })
   * ```
   */
  metadataEnhancer?: (doc: Document) => Document;

  /**
   * Redis 客户端（用于任务管理和多级缓存）
   * 如果提供，将启用任务管理功能（断点续传、进度跟踪等）
   */
  redis?: IRedisClient;

  /**
   * OCR 服务实例（用于扫描 PDF 处理）
   * 从 @nestai/ocr 模块注入
   */
  ocrService?: IOCRService;

  /**
   * 是否自动检测扫描 PDF
   * @default true
   */
  autoDetectScannedPdf?: boolean;

  /**
   * OCR 提示词（用于扫描 PDF 识别）
   */
  defaultOcrPrompt?: string;

  /**
   * 限流配置
   */
  rateLimit?: {
    /** 最大请求数 */
    maxRequests: number;
    /** 时间窗口（毫秒） */
    windowMs: number;
    /** 限流算法 */
    algorithm?: 'token_bucket' | 'sliding_window' | 'fixed_window';
  };

  /**
   * 熔断器配置
   */
  circuitBreaker?: {
    /** 失败阈值 */
    failureThreshold: number;
    /** 成功阈值 */
    successThreshold: number;
    /** 超时时间（毫秒） */
    timeout: number;
    /** 重置超时时间（毫秒） */
    resetTimeout: number;
  };

  /**
   * 文件验证配置
   */
  fileValidation?: {
    /** 最大文件大小（字节） */
    maxSize?: number;
    /** 允许的 MIME 类型 */
    allowedMimeTypes?: string[];
    /** 允许的文件扩展名 */
    allowedExtensions?: string[];
    /** 是否严格验证 MIME 类型 */
    strictMimeValidation?: boolean;
  };

  /**
   * 批量处理配置
   */
  batchProcessing?: {
    /** 并发数 */
    concurrency?: number;
    /** 是否在单个文件失败时继续处理 */
    continueOnError?: boolean;
  };

  /**
   * 性能监控配置
   */
  monitoring?: {
    /** 是否启用详细指标 */
    enableDetailedMetrics?: boolean;
    /** 慢操作阈值（毫秒） */
    slowOperationThreshold?: number;
    /** 最大保留指标数 */
    maxMetrics?: number;
  };

  /**
   * OCR 模型配置（用于内置默认 OCR 实现）
   *
   * 当未提供 ocrService 但提供了此配置时，
   * 模块会自动创建基于 AI SDK 的默认 OCR 服务
   *
   * @example
   * ```typescript
   * DocumentModule.register({
   *   ocrModel: {
   *     modelName: 'gpt-4o',
   *     apiKey: 'sk-xxx',
   *     baseUrl: 'https://api.openai.com/v1',
   *   },
   * })
   * ```
   */
  ocrModel?: AiModelConfig;

  /**
   * Embedding 服务实例（用于文档向量化）
   *
   * 可传入自定义实现，或通过 embeddingModel 配置使用内置默认实现
   */
  embeddingService?: IEmbeddingService;

  /**
   * Embedding 模型配置（用于内置默认 Embedding 实现）
   *
   * 当未提供 embeddingService 但提供了此配置时，
   * 模块会自动创建基于 AI SDK 的默认 Embedding 服务
   *
   * @example
   * ```typescript
   * DocumentModule.register({
   *   embeddingModel: {
   *     modelName: 'text-embedding-3-small',
   *     apiKey: 'sk-xxx',
   *     baseUrl: 'https://api.openai.com/v1',
   *   },
   * })
   * ```
   */
  embeddingModel?: AiModelConfig;
}
