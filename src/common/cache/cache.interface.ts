import { Document } from '../../models/document.model';

/** 缓存服务注入令牌 */
export const CACHE_SERVICE_TOKEN = 'DOCUMENT_CACHE_SERVICE';

/**
 * 文档缓存服务接口
 *
 * 统一 L1 内存缓存和多级缓存的访问方式
 */
export interface IDocumentCacheService {
  /** 获取缓存 */
  get(key: string): Promise<Document[] | null> | Document[] | null;
  /** 设置缓存 */
  set(key: string, value: Document[], ttl?: number): Promise<void> | void;
  /** 删除缓存 */
  delete(key: string): Promise<void | boolean> | void | boolean;
  /** 清空所有缓存 */
  clear(): Promise<void> | void;
}
