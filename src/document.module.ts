import { DynamicModule, Module, Provider, Logger } from '@nestjs/common';
import {
  ConfigurableModuleClass,
  OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE,
  DOCUMENT_MODULE_OPTIONS,
} from './document.module-definition';
import { DocumentModuleOptions } from './document-module-options.interface';
import { DocumentService } from './document.service';
import { DocumentTaskService, STATE_STORE_TOKEN } from './progress/document-task.service';
import { RedisDocumentStateStore } from './progress/redis-state.store';
import type { IDocumentStateStore } from './progress/state-store.interface';
import { DocumentCacheService } from './common/cache/document-cache.service';
import { MultiLevelCacheService } from './common/cache/multi-level-cache.service';
import { CACHE_SERVICE_TOKEN } from './common/cache/cache.interface';
import { PerformanceMonitorService } from './common/monitoring/performance-monitor.service';
import { DocumentHealthService } from './common/health/document-health.service';
import { RateLimiterService } from './common/resilience/rate-limiter.service';
import { CircuitBreakerService } from './common/resilience/circuit-breaker.service';
import { FileValidatorService } from './common/validation/file-validator.service';
import { safeValidateDocumentModuleOptions } from './common/validation/config.schema';
import { ConfigValidationError } from './common/errors/document.errors';
import { AiSdkOcrService } from './common/ocr/ai-sdk-ocr.service';
import { AiSdkEmbeddingService } from './common/embedding/ai-sdk-embedding.service';
import type { IRedisClient } from './common/interfaces/redis-client.interface';
import type { IOCRService } from './common/interfaces/ocr-service.interface';

/** Redis 客户端注入令牌 */
export const REDIS_CLIENT_TOKEN = 'REDIS_CLIENT';
/** OCR 服务注入令牌 */
export const OCR_SERVICE_TOKEN = 'OCR_SERVICE';
/** Embedding 服务注入令牌 */
export const EMBEDDING_SERVICE_TOKEN = 'EMBEDDING_SERVICE';

/**
 * Document 模块
 *
 * 提供文档加载、处理功能
 *
 * @example
 * ```typescript
 * // 基础使用
 * DocumentModule.register({
 *   enableCache: true,
 *   cacheTTL: 3600000,
 * })
 *
 * // 带任务管理和 OCR 支持
 * DocumentModule.register({
 *   redis: redisClient,
 *   ocrService: ocrService,
 *   autoDetectScannedPdf: true,
 *   defaultOcrPrompt: '请识别图片中的文字',
 * })
 * ```
 */
@Module({})
export class DocumentModule extends ConfigurableModuleClass {
  private static readonly logger = new Logger(DocumentModule.name);

  /**
   * 同步注册模块
   */
  static register(options: typeof OPTIONS_TYPE = {}): DynamicModule {
    const validationResult = safeValidateDocumentModuleOptions(options);
    if (!validationResult.success) {
      const errorMessages = validationResult.error.issues
        .map((issue: any) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new ConfigValidationError(
        `模块配置验证失败: ${errorMessages}`,
        { issues: validationResult.error.issues },
      );
    }

    const opts = validationResult.data as typeof OPTIONS_TYPE;

    // 自动创建默认 OCR 服务（外部未传递 ocrService 但提供了 ocrModel 配置）
    if (!opts.ocrService && opts.ocrModel) {
      this.logger.log('未提供 ocrService，使用内置 AiSdkOcrService');
      opts.ocrService = new AiSdkOcrService({
        modelName: opts.ocrModel.modelName,
        providerName: opts.ocrModel.providerName,
        apiKey: opts.ocrModel.apiKey,
        baseUrl: opts.ocrModel.baseUrl,
        defaultPrompt: opts.defaultOcrPrompt,
      });
    }

    // 自动创建默认 Embedding 服务（外部未传递 embeddingService 但提供了 embeddingModel 配置）
    if (!opts.embeddingService && opts.embeddingModel) {
      this.logger.log('未提供 embeddingService，使用内置 AiSdkEmbeddingService');
      opts.embeddingService = new AiSdkEmbeddingService({
        modelName: opts.embeddingModel.modelName,
        providerName: opts.embeddingModel.providerName,
        apiKey: opts.embeddingModel.apiKey,
        baseUrl: opts.embeddingModel.baseUrl,
      });
    }

    this.logger.log('注册 DocumentModule', {
      cacheEnabled: opts.enableCache,
      cacheStrategy: opts.cacheStrategy,
      hasRedis: !!opts.redis,
      hasOCR: !!opts.ocrService,
      hasEmbedding: !!opts.embeddingService,
    });

    const { providers, exports: moduleExports } = this.buildProviders(opts);

    const baseModule = super.register(opts);
    return {
      ...baseModule,
      providers: [...(baseModule.providers || []), ...providers],
      exports: moduleExports,
    };
  }

  /**
   * 异步注册模块
   */
  static registerAsync(options: typeof ASYNC_OPTIONS_TYPE): DynamicModule {
    const { providers: asyncProviders, exports: asyncExports } =
      this.buildAsyncProviders();

    const baseModule = super.registerAsync(options);
    return {
      ...baseModule,
      providers: [...(baseModule.providers || []), ...asyncProviders],
      exports: asyncExports,
    };
  }

  /**
   * 根据配置构建 providers（同步注册）
   */
  private static buildProviders(opts: DocumentModuleOptions): {
    providers: Provider[];
    exports: (Function | string)[];
  } {
    const providers: Provider[] = [
      DocumentService,
      PerformanceMonitorService,
      RateLimiterService,
      CircuitBreakerService,
      FileValidatorService,
    ];
    const moduleExports: (Function | string)[] = [
      DocumentService,
      PerformanceMonitorService,
      RateLimiterService,
      CircuitBreakerService,
      FileValidatorService,
    ];

    // OCR 服务（外部传入或自动创建的）
    if (opts.ocrService) {
      providers.push({
        provide: OCR_SERVICE_TOKEN,
        useValue: opts.ocrService,
      });
    }

    // Embedding 服务（外部传入或自动创建的）
    if (opts.embeddingService) {
      providers.push({
        provide: EMBEDDING_SERVICE_TOKEN,
        useValue: opts.embeddingService,
      });
      moduleExports.push(EMBEDDING_SERVICE_TOKEN);
    }

    // Redis 客户端
    if (opts.redis) {
      providers.push(
        { provide: REDIS_CLIENT_TOKEN, useValue: opts.redis },
        { provide: STATE_STORE_TOKEN, useFactory: () => new RedisDocumentStateStore(opts.redis!) },
        DocumentTaskService,
        {
          provide: DocumentHealthService,
          useFactory: (redis: IRedisClient, ocr?: IOCRService) => {
            return new DocumentHealthService(redis, ocr);
          },
          inject: [
            REDIS_CLIENT_TOKEN,
            { token: OCR_SERVICE_TOKEN, optional: true },
          ],
        },
      );
      moduleExports.push(
        DocumentTaskService,
        DocumentHealthService,
      );
    }

    // 缓存：统一注册到 CACHE_SERVICE_TOKEN
    if (opts.enableCache) {
      if (opts.cacheStrategy === 'multi-level' && opts.redis) {
        providers.push({
          provide: CACHE_SERVICE_TOKEN,
          useFactory: (redis: IRedisClient) =>
            new MultiLevelCacheService(
              {
                l1TTL: opts.multiLevelCache?.l1TTL || opts.cacheTTL || 3600000,
                l2TTL: opts.multiLevelCache?.l2TTL || opts.cacheTTL || 3600000,
                l1MaxSize: opts.multiLevelCache?.l1MaxSize || 1000,
                enableL2: true,
              },
              redis,
            ),
          inject: [REDIS_CLIENT_TOKEN],
        });
      } else {
        providers.push({
          provide: CACHE_SERVICE_TOKEN,
          useFactory: () => new DocumentCacheService(opts.cacheTTL),
        });
      }
      moduleExports.push(CACHE_SERVICE_TOKEN);
    }

    return { providers, exports: moduleExports };
  }

  /**
   * 构建异步 providers（运行时根据注入的配置条件化创建）
   */
  private static buildAsyncProviders(): {
    providers: Provider[];
    exports: (Function | string)[];
  } {
    const providers: Provider[] = [
      DocumentService,
      PerformanceMonitorService,
      RateLimiterService,
      CircuitBreakerService,
      FileValidatorService,
    ];
    const moduleExports: (Function | string)[] = [
      DocumentService,
      PerformanceMonitorService,
      RateLimiterService,
      CircuitBreakerService,
      FileValidatorService,
    ];

    // 配置验证
    providers.push({
      provide: 'VALIDATED_OPTIONS',
      useFactory: (rawOpts: DocumentModuleOptions) => {
        const result = safeValidateDocumentModuleOptions(rawOpts);
        if (!result.success) {
          const msg = result.error.issues
            .map((i: any) => `${i.path.join('.')}: ${i.message}`)
            .join(', ');
          throw new ConfigValidationError(`模块配置验证失败: ${msg}`, {
            issues: result.error.issues,
          });
        }
        return result.data;
      },
      inject: [DOCUMENT_MODULE_OPTIONS],
    });

    // Redis 客户端（条件注册）
    providers.push({
      provide: REDIS_CLIENT_TOKEN,
      useFactory: (opts: DocumentModuleOptions) => opts.redis ?? null,
      inject: ['VALIDATED_OPTIONS'],
    });

    // OCR 服务（条件注册：外部传入 > ocrModel 自动创建 > null）
    providers.push({
      provide: OCR_SERVICE_TOKEN,
      useFactory: (opts: DocumentModuleOptions) => {
        if (opts.ocrService) return opts.ocrService;
        if (opts.ocrModel) {
          this.logger.log('未提供 ocrService，使用内置 AiSdkOcrService');
          return new AiSdkOcrService({
            modelName: opts.ocrModel.modelName,
            providerName: opts.ocrModel.providerName,
            apiKey: opts.ocrModel.apiKey,
            baseUrl: opts.ocrModel.baseUrl,
            defaultPrompt: opts.defaultOcrPrompt,
          });
        }
        return null;
      },
      inject: ['VALIDATED_OPTIONS'],
    });

    // Embedding 服务（条件注册：外部传入 > embeddingModel 自动创建 > null）
    providers.push({
      provide: EMBEDDING_SERVICE_TOKEN,
      useFactory: (opts: DocumentModuleOptions) => {
        if (opts.embeddingService) return opts.embeddingService;
        if (opts.embeddingModel) {
          this.logger.log('未提供 embeddingService，使用内置 AiSdkEmbeddingService');
          return new AiSdkEmbeddingService({
            modelName: opts.embeddingModel.modelName,
            providerName: opts.embeddingModel.providerName,
            apiKey: opts.embeddingModel.apiKey,
            baseUrl: opts.embeddingModel.baseUrl,
          });
        }
        return null;
      },
      inject: ['VALIDATED_OPTIONS'],
    });
    moduleExports.push(EMBEDDING_SERVICE_TOKEN);

    // State Store（条件注册）
    providers.push({
      provide: STATE_STORE_TOKEN,
      useFactory: (opts: DocumentModuleOptions) => {
        if (opts.redis) {
          return new RedisDocumentStateStore(opts.redis);
        }
        return null;
      },
      inject: ['VALIDATED_OPTIONS'],
    });

    // DocumentTaskService（条件注册，复用 STATE_STORE_TOKEN 避免重复实例化）
    providers.push({
      provide: DocumentTaskService,
      useFactory: (opts: DocumentModuleOptions, store: IDocumentStateStore | null) => {
        if (opts.redis && store) {
          return new DocumentTaskService(opts.redis, store);
        }
        return null;
      },
      inject: ['VALIDATED_OPTIONS', STATE_STORE_TOKEN],
    });
    moduleExports.push(DocumentTaskService);

    // DocumentHealthService（条件注册，使用解析后的 OCR 服务）
    providers.push({
      provide: DocumentHealthService,
      useFactory: (opts: DocumentModuleOptions, ocr?: IOCRService) => {
        if (opts.redis) {
          return new DocumentHealthService(opts.redis, ocr ?? undefined);
        }
        return null;
      },
      inject: ['VALIDATED_OPTIONS', { token: OCR_SERVICE_TOKEN, optional: true }],
    });
    moduleExports.push(DocumentHealthService);

    // 缓存：统一注册到 CACHE_SERVICE_TOKEN
    providers.push({
      provide: CACHE_SERVICE_TOKEN,
      useFactory: (opts: DocumentModuleOptions) => {
        if (!opts.enableCache) {
          return null;
        }
        if (opts.cacheStrategy === 'multi-level' && opts.redis) {
          return new MultiLevelCacheService(
            {
              l1TTL: opts.multiLevelCache?.l1TTL || opts.cacheTTL || 3600000,
              l2TTL: opts.multiLevelCache?.l2TTL || opts.cacheTTL || 3600000,
              l1MaxSize: opts.multiLevelCache?.l1MaxSize || 1000,
              enableL2: true,
            },
            opts.redis,
          );
        }
        if (opts.cacheStrategy === 'multi-level' && !opts.redis) {
          this.logger.warn('cacheStrategy 为 multi-level 但未提供 redis，降级为内存缓存');
        }
        return new DocumentCacheService(opts.cacheTTL);
      },
      inject: ['VALIDATED_OPTIONS'],
    });
    moduleExports.push(CACHE_SERVICE_TOKEN);

    return { providers, exports: moduleExports };
  }
}
