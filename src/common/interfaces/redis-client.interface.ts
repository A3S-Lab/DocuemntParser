/**
 * Redis 客户端接口
 *
 * 定义 Document 模块所需的最小 Redis 操作集合，
 * 兼容 ioredis 和其他 Redis 客户端实现
 */
export interface IRedisClient {
  /** 获取键值 */
  get(key: string): Promise<string | null>;
  /** 设置键值并指定过期时间（秒） */
  setex(key: string, seconds: number, value: string): Promise<string>;
  /** 删除键 */
  del(...keys: string[]): Promise<number>;
  /**
   * 按模式查找键
   *
   * 注意：生产环境中应优先使用 scanKeys（基于 SCAN 命令），
   * keys 命令会阻塞 Redis，仅作为 fallback
   */
  keys(pattern: string): Promise<string[]>;
  /** 添加集合成员 */
  sadd(key: string, ...members: string[]): Promise<number>;
  /** 获取集合所有成员 */
  smembers(key: string): Promise<string[]>;
  /** 获取集合大小 */
  scard(key: string): Promise<number>;
  /** 设置键过期时间（秒） */
  expire(key: string, seconds: number): Promise<number>;
  /** 健康检查 */
  ping(): Promise<string>;
  /** 执行 Lua 脚本 */
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  /**
   * 基于 SCAN 命令的安全键扫描（可选）
   *
   * 如果 Redis 客户端支持，优先使用此方法替代 keys()
   * ioredis 示例: `async scanKeys(pattern) { const keys = []; let cursor = '0'; do { const [c, k] = await this.scan(cursor, 'MATCH', pattern, 'COUNT', 100); cursor = c; keys.push(...k); } while (cursor !== '0'); return keys; }`
   */
  scanKeys?(pattern: string): Promise<string[]>;
}
