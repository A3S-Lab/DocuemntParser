import { Injectable, Logger } from '@nestjs/common';
import { IRedisClient } from '../interfaces/redis-client.interface';
import { IOCRService } from '../interfaces/ocr-service.interface';

/**
 * 健康检查状态
 */
export enum HealthStatus {
  UP = 'up',
  DOWN = 'down',
  DEGRADED = 'degraded',
}

/**
 * 健康检查详情
 */
export interface HealthCheckDetail {
  status: HealthStatus;
  message?: string;
  timestamp: string;
  details?: Record<string, any>;
}

/**
 * 健康检查结果
 */
export interface HealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  checks: {
    module: HealthCheckDetail;
    redis?: HealthCheckDetail;
    ocr?: HealthCheckDetail;
  };
}

/**
 * Document 模块健康检查服务
 */
@Injectable()
export class DocumentHealthService {
  private readonly logger = new Logger(DocumentHealthService.name);

  constructor(
    private readonly redisClient?: IRedisClient,
    private readonly ocrService?: IOCRService,
  ) {}

  /**
   * 执行健康检查
   */
  async check(): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    const checks: HealthCheckResult['checks'] = {
      module: await this.checkModule(),
    };

    // 检查 Redis 连接
    if (this.redisClient) {
      checks.redis = await this.checkRedis();
    }

    // 检查 OCR 服务
    if (this.ocrService) {
      checks.ocr = await this.checkOCR();
    }

    // 计算整体状态
    const status = this.calculateOverallStatus(checks);

    return {
      status,
      timestamp,
      checks,
    };
  }

  /**
   * 检查模块基础功能
   */
  private async checkModule(): Promise<HealthCheckDetail> {
    try {
      return {
        status: HealthStatus.UP,
        message: 'Document module is operational',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Module health check failed', error);
      return {
        status: HealthStatus.DOWN,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查 Redis 连接
   */
  private async checkRedis(): Promise<HealthCheckDetail> {
    try {
      await this.redisClient!.ping();
      return {
        status: HealthStatus.UP,
        message: 'Redis connection is healthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return {
        status: HealthStatus.DOWN,
        message: error instanceof Error ? error.message : 'Redis connection failed',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 检查 OCR 服务
   */
  private async checkOCR(): Promise<HealthCheckDetail> {
    try {
      // 假设 OCR 服务有健康检查方法
      if (typeof this.ocrService!.healthCheck === 'function') {
        await this.ocrService!.healthCheck();
      }
      return {
        status: HealthStatus.UP,
        message: 'OCR service is available',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('OCR health check failed', error);
      return {
        status: HealthStatus.DOWN,
        message: error instanceof Error ? error.message : 'OCR service unavailable',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 计算整体健康状态
   */
  private calculateOverallStatus(checks: HealthCheckResult['checks']): HealthStatus {
    const statuses = Object.values(checks).map(check => check.status);

    if (statuses.every(status => status === HealthStatus.UP)) {
      return HealthStatus.UP;
    }

    if (statuses.every(status => status === HealthStatus.DOWN)) {
      return HealthStatus.DOWN;
    }

    return HealthStatus.DEGRADED;
  }
}
