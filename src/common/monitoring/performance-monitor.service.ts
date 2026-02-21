import { Injectable, Logger, Inject, Optional, OnModuleDestroy } from '@nestjs/common';
import { DOCUMENT_MODULE_OPTIONS } from '../../document.module-definition';
import type { DocumentModuleOptions } from '../../document-module-options.interface';

/**
 * 性能监控配置
 */
export interface MonitoringConfig {
  /** 是否启用详细指标 */
  enableDetailedMetrics?: boolean;
  /** 慢操作阈值（毫秒） @default 5000 */
  slowOperationThreshold?: number;
  /** 每个操作最大保留指标数 @default 10000 */
  maxMetrics?: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  /** 操作名称 */
  operation: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 持续时间（毫秒） */
  duration?: number;
  /** 是否成功 */
  success?: boolean;
  /** 错误信息 */
  error?: string;
  /** 额外元数据 */
  metadata?: Record<string, any>;
}

/**
 * 聚合指标
 */
export interface AggregatedMetrics {
  operation: string;
  count: number;
  successCount: number;
  failureCount: number;
  errorRate: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  /** 中位数（P50） */
  p50: number;
  /** 95 分位数 */
  p95: number;
  /** 99 分位数 */
  p99: number;
  /** 吞吐量（每秒请求数） */
  throughput: number;
  /** 当前并发数 */
  concurrency: number;
  /** 最后更新时间 */
  lastUpdated: string;
}

/**
 * 性能监控服务
 *
 * 提供操作计时、聚合指标（含百分位数）、并发追踪、
 * 实时窗口指标、慢操作检测和错误列表等功能
 */
@Injectable()
export class PerformanceMonitorService implements OnModuleDestroy {
  private readonly logger = new Logger(PerformanceMonitorService.name);
  private readonly metrics = new Map<string, PerformanceMetrics[]>();
  private readonly concurrency = new Map<string, number>();
  private readonly maxMetricsPerOperation: number;
  private readonly slowOperationThreshold: number;
  private readonly startTime = Date.now();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(
    @Optional()
    @Inject(DOCUMENT_MODULE_OPTIONS)
    options?: DocumentModuleOptions,
  ) {
    const monitoring = options?.monitoring;
    this.maxMetricsPerOperation = monitoring?.maxMetrics ?? 10000;
    this.slowOperationThreshold = monitoring?.slowOperationThreshold ?? 5000;

    // 每 60 秒自动清理过期未完成的 metric
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleMetrics();
    }, 60_000);
    // 不阻止进程正常退出
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  onModuleDestroy(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * 开始记录操作
   */
  startOperation(operation: string, metadata?: Record<string, any>): string {
    const id = `${operation}-${Date.now()}-${Math.random()}`;
    const metric: PerformanceMetrics & { id: string } = {
      id,
      operation,
      startTime: Date.now(),
      metadata,
    };

    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
      this.concurrency.set(operation, 0);
    }

    const operationMetrics = this.metrics.get(operation)!;
    operationMetrics.push(metric);

    // 增加并发计数
    this.concurrency.set(operation, (this.concurrency.get(operation) || 0) + 1);

    // 限制内存使用
    if (operationMetrics.length > this.maxMetricsPerOperation) {
      const evicted = operationMetrics.shift();
      // 如果被驱逐的 metric 尚未完成，修正并发计数
      if (evicted && evicted.endTime === undefined) {
        this.concurrency.set(operation, Math.max(0, (this.concurrency.get(operation) || 0) - 1));
      }
    }

    return id;
  }

  /**
   * 结束记录操作
   *
   * @param id - startOperation 返回的唯一标识，精确匹配对应的 metric
   *             也兼容传入 operation 名称（向后兼容，取最后一个未完成的 metric）
   */
  endOperation(
    id: string,
    success: boolean = true,
    error?: string,
    metadata?: Record<string, any>
  ): void {
    // 先尝试按 id 精确匹配
    let metric: PerformanceMetrics | undefined;
    let operation: string | undefined;

    for (const [op, metrics] of this.metrics.entries()) {
      const found = metrics.find(m => (m as any).id === id && m.endTime === undefined);
      if (found) {
        metric = found;
        operation = op;
        break;
      }
    }

    // 向后兼容：按 operation 名称匹配最后一个未完成的 metric
    if (!metric) {
      const operationMetrics = this.metrics.get(id);
      if (operationMetrics && operationMetrics.length > 0) {
        operation = id;
        // 找最后一个未完成的 metric
        for (let i = operationMetrics.length - 1; i >= 0; i--) {
          if (operationMetrics[i].endTime === undefined) {
            metric = operationMetrics[i];
            break;
          }
        }
      }
    }

    if (!metric || !operation) {
      return;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.success = success;
    metric.error = error;
    metric.metadata = { ...metric.metadata, ...metadata };

    // 减少并发计数
    this.concurrency.set(operation, Math.max(0, (this.concurrency.get(operation) || 0) - 1));

    // 记录慢操作
    if (metric.duration > this.slowOperationThreshold) {
      this.logger.warn(`慢操作检测`, {
        operation,
        duration: metric.duration,
        metadata: metric.metadata,
      });
    }

    // 记录失败操作
    if (!success) {
      this.logger.error(`操作失败`, {
        operation,
        duration: metric.duration,
        error,
        metadata: metric.metadata,
      });
    }
  }

  /**
   * 记录操作（自动计时）
   */
  async recordOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const id = this.startOperation(operation, metadata);

    try {
      const result = await fn();
      this.endOperation(id, true, undefined, metadata);
      return result;
    } catch (error) {
      this.endOperation(
        id,
        false,
        error instanceof Error ? error.message : String(error),
        metadata
      );
      throw error;
    }
  }

  /**
   * 获取操作的聚合指标（含百分位数、吞吐量、并发）
   */
  getAggregatedMetrics(operation: string): AggregatedMetrics | null {
    const operationMetrics = this.metrics.get(operation);
    if (!operationMetrics || operationMetrics.length === 0) {
      return null;
    }

    const completedMetrics = operationMetrics.filter(m => m.duration !== undefined);
    if (completedMetrics.length === 0) {
      return null;
    }

    const durations = completedMetrics.map(m => m.duration!).sort((a, b) => a - b);
    const successCount = completedMetrics.filter(m => m.success).length;
    const failureCount = completedMetrics.length - successCount;
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    const timeRange = Date.now() - this.startTime;
    const throughput = (completedMetrics.length / timeRange) * 1000;

    return {
      operation,
      count: completedMetrics.length,
      successCount,
      failureCount,
      errorRate: failureCount / completedMetrics.length,
      totalDuration,
      avgDuration: totalDuration / completedMetrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p50: this.calculatePercentile(durations, 0.5),
      p95: this.calculatePercentile(durations, 0.95),
      p99: this.calculatePercentile(durations, 0.99),
      throughput,
      concurrency: this.concurrency.get(operation) || 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 获取所有操作的聚合指标
   */
  getAllAggregatedMetrics(): AggregatedMetrics[] {
    const results: AggregatedMetrics[] = [];

    for (const operation of this.metrics.keys()) {
      const metrics = this.getAggregatedMetrics(operation);
      if (metrics) {
        results.push(metrics);
      }
    }

    return results;
  }

  /**
   * 获取实时指标（最近 N 秒窗口）
   */
  getRealtimeMetrics(operation: string, windowSeconds: number = 60): AggregatedMetrics | null {
    const operationMetrics = this.metrics.get(operation);
    if (!operationMetrics || operationMetrics.length === 0) {
      return null;
    }

    const cutoff = Date.now() - windowSeconds * 1000;
    const recentMetrics = operationMetrics.filter(
      m => m.endTime && m.endTime > cutoff && m.duration !== undefined
    );

    if (recentMetrics.length === 0) {
      return null;
    }

    const durations = recentMetrics.map(m => m.duration!).sort((a, b) => a - b);
    const successCount = recentMetrics.filter(m => m.success).length;
    const failureCount = recentMetrics.length - successCount;
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const throughput = recentMetrics.length / windowSeconds;

    return {
      operation,
      count: recentMetrics.length,
      successCount,
      failureCount,
      errorRate: failureCount / recentMetrics.length,
      totalDuration,
      avgDuration: totalDuration / recentMetrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      p50: this.calculatePercentile(durations, 0.5),
      p95: this.calculatePercentile(durations, 0.95),
      p99: this.calculatePercentile(durations, 0.99),
      throughput,
      concurrency: this.concurrency.get(operation) || 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 获取慢操作列表
   */
  getSlowOperations(thresholdMs: number = 5000): Array<{
    operation: string;
    duration: number;
    timestamp: string;
    metadata?: Record<string, any>;
  }> {
    const slowOps: Array<{
      operation: string;
      duration: number;
      timestamp: string;
      metadata?: Record<string, any>;
    }> = [];

    for (const [operation, metrics] of this.metrics.entries()) {
      for (const metric of metrics) {
        if (metric.duration && metric.duration > thresholdMs) {
          slowOps.push({
            operation,
            duration: metric.duration,
            timestamp: new Date(metric.endTime!).toISOString(),
            metadata: metric.metadata,
          });
        }
      }
    }

    return slowOps.sort((a, b) => b.duration - a.duration);
  }

  /**
   * 获取错误列表
   */
  getErrors(limit: number = 100): Array<{
    operation: string;
    error: string;
    timestamp: string;
    duration?: number;
    metadata?: Record<string, any>;
  }> {
    const errors: Array<{
      operation: string;
      error: string;
      timestamp: string;
      duration?: number;
      metadata?: Record<string, any>;
    }> = [];

    for (const [operation, metrics] of this.metrics.entries()) {
      for (const metric of metrics) {
        if (!metric.success && metric.error) {
          errors.push({
            operation,
            error: metric.error,
            timestamp: new Date(metric.endTime!).toISOString(),
            duration: metric.duration,
            metadata: metric.metadata,
          });
        }
      }
    }

    return errors.slice(-limit);
  }

  /**
   * 清除指定操作的指标
   */
  clearMetrics(operation: string): void {
    this.metrics.delete(operation);
    this.concurrency.delete(operation);
  }

  /**
   * 清除所有指标
   */
  clearAllMetrics(): void {
    this.metrics.clear();
    this.concurrency.clear();
  }

  /**
   * 获取原始指标数据
   */
  getRawMetrics(operation: string): PerformanceMetrics[] {
    return this.metrics.get(operation) || [];
  }

  /**
   * 清理过期的未完成 metric（防止并发计数永久增长）
   *
   * 超过 staleThresholdMs 未完成的 metric 会被标记为失败并修正并发计数
   *
   * @param staleThresholdMs 过期阈值（毫秒），默认 5 分钟
   */
  cleanupStaleMetrics(staleThresholdMs: number = 300000): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [operation, metrics] of this.metrics.entries()) {
      for (const metric of metrics) {
        if (metric.endTime === undefined && (now - metric.startTime) > staleThresholdMs) {
          metric.endTime = now;
          metric.duration = now - metric.startTime;
          metric.success = false;
          metric.error = 'stale metric cleaned up (no endOperation called)';
          this.concurrency.set(operation, Math.max(0, (this.concurrency.get(operation) || 0) - 1));
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.warn(`清理了 ${cleanedCount} 个过期未完成的 metric`);
    }

    return cleanedCount;
  }

  /**
   * 计算百分位数
   */
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, index)];
  }
}
