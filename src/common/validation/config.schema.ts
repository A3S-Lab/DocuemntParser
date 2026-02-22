import { z } from 'zod';

/**
 * Document 模块配置验证 Schema
 */
export const DocumentModuleOptionsSchema = z
  .object({
    /**
     * 是否启用缓存
     */
    enableCache: z.boolean().optional().default(false),

    /**
     * 缓存过期时间（毫秒）
     */
    cacheTTL: z.number().positive().optional().default(3600000),

    /**
     * 缓存策略
     */
    cacheStrategy: z.enum(['memory', 'multi-level']).optional().default('memory'),

    /**
     * 多级缓存配置
     */
    multiLevelCache: z
      .object({
        l1TTL: z.number().positive().optional(),
        l2TTL: z.number().positive().optional(),
        l1MaxSize: z.number().positive().optional(),
      })
      .optional(),

    /**
     * 文档处理器管道
     */
    processors: z.array(z.any()).optional(),

    /**
     * 元数据增强函数
     */
    metadataEnhancer: z.any().optional(),

    /**
     * Redis 客户端
     */
    redis: z.any().optional(),

    /**
     * OCR 服务实例
     */
    ocrService: z.any().optional(),

    /**
     * 是否自动检测扫描 PDF
     */
    autoDetectScannedPdf: z.boolean().optional().default(true),

    /**
     * OCR 提示词
     */
    defaultOcrPrompt: z.string().optional(),

    /**
     * 限流配置
     */
    rateLimit: z
      .object({
        maxRequests: z.number().positive(),
        windowMs: z.number().positive(),
        algorithm: z.enum(['token_bucket', 'sliding_window', 'fixed_window']).optional(),
      })
      .optional(),

    /**
     * 熔断器配置
     */
    circuitBreaker: z
      .object({
        failureThreshold: z.number().positive(),
        successThreshold: z.number().positive(),
        timeout: z.number().positive(),
        resetTimeout: z.number().positive(),
      })
      .optional(),

    /**
     * 文件验证配置
     */
    fileValidation: z
      .object({
        maxSize: z.number().positive().optional(),
        allowedMimeTypes: z.array(z.string()).optional(),
        allowedExtensions: z.array(z.string()).optional(),
        strictMimeValidation: z.boolean().optional(),
      })
      .optional(),

    /**
     * 批量处理配置
     */
    batchProcessing: z
      .object({
        concurrency: z.number().positive().optional(),
        continueOnError: z.boolean().optional(),
      })
      .optional(),

    /**
     * 性能监控配置
     */
    monitoring: z
      .object({
        enableDetailedMetrics: z.boolean().optional(),
        slowOperationThreshold: z.number().positive().optional(),
        maxMetrics: z.number().positive().optional(),
      })
      .optional(),

    /**
     * AI 模型配置 Schema
     */
    ocrModel: z
      .object({
        modelName: z.string(),
        providerName: z.string().optional(),
        apiKey: z.string(),
        baseUrl: z.string(),
      })
      .optional(),

    /**
     * Embedding 服务实例
     */
    embeddingService: z.any().optional(),

    /**
     * Embedding 模型配置
     */
    embeddingModel: z
      .object({
        modelName: z.string(),
        providerName: z.string().optional(),
        apiKey: z.string(),
        baseUrl: z.string(),
      })
      .optional(),
  })
  .passthrough(); // 允许额外的属性

/**
 * 安全验证配置选项（返回结果而不抛出异常）
 */
export function safeValidateDocumentModuleOptions(options: unknown) {
  return DocumentModuleOptionsSchema.safeParse(options);
}
