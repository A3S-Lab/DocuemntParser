import { Test, TestingModule } from '@nestjs/testing';
import { MultiLevelCacheService } from './multi-level-cache.service';
import { Document } from '../../models/document.model';

// Mock Redis client
class MockRedisClient {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flushdb(): Promise<void> {
    this.store.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}

// Helper function to create test documents
function createDocs(content: string): Document[] {
  return [{ pageContent: content, metadata: {} }] as any;
}

describe('MultiLevelCacheService', () => {
  let service: MultiLevelCacheService;
  let mockRedis: MockRedisClient;

  beforeEach(async () => {
    mockRedis = new MockRedisClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: MultiLevelCacheService,
          useFactory: () => {
            return new MultiLevelCacheService(
              {
                l1TTL: 1000,
                l2TTL: 2000,
                l1MaxSize: 100,
                enableL2: true,
              },
              mockRedis as any
            );
          },
        },
      ],
    }).compile();

    service = module.get<MultiLevelCacheService>(MultiLevelCacheService);
  });

  afterEach(async () => {
    await service.clear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('L1 Cache (Memory)', () => {
    it('should store and retrieve from L1 cache', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);
      const value = await service.get('key1');

      expect(value).toEqual(docs);
    });

    it('should return null for non-existent keys', async () => {
      const value = await service.get('nonexistent');
      expect(value).toBeNull();
    });

    it('should expire L1 cache entries after TTL', async () => {
      const shortTTLService = new MultiLevelCacheService(
        {
          l1TTL: 100,
          l2TTL: 2000,
          l1MaxSize: 100,
          enableL2: false,
        },
        mockRedis as any
      );

      const docs = createDocs('value1');
      await shortTTLService.set('key1', docs);
      expect(await shortTTLService.get('key1')).toEqual(docs);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(await shortTTLService.get('key1')).toBeNull();
    });

    it('should enforce L1 max size with LRU eviction', async () => {
      const smallCacheService = new MultiLevelCacheService(
        {
          l1TTL: 10000,
          l2TTL: 20000,
          l1MaxSize: 3,
          enableL2: false,
        },
        mockRedis as any
      );

      await smallCacheService.set('key1', createDocs('value1'));
      await smallCacheService.set('key2', createDocs('value2'));
      await smallCacheService.set('key3', createDocs('value3'));

      // 访问 key1 使其成为最近使用
      await smallCacheService.get('key1');

      // 添加第 4 个键，应该淘汰 key2（最少使用）
      await smallCacheService.set('key4', createDocs('value4'));

      expect(await smallCacheService.get('key1')).toBeTruthy();
      expect(await smallCacheService.get('key2')).toBeNull();
      expect(await smallCacheService.get('key3')).toBeTruthy();
      expect(await smallCacheService.get('key4')).toBeTruthy();
    });
  });

  describe('L2 Cache (Redis)', () => {
    it('should store and retrieve from L2 cache', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);

      // 清除 L1 缓存
      await service.clear();

      // 应该从 L2 获取
      const value = await service.get('key1');
      expect(value).toBeTruthy();
    });

    it('should backfill L1 from L2', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);

      // 清除 L1 缓存（但保留 L2）
      await service.clear();

      // 第一次从 L2 获取
      const value1 = await service.get('key1');
      expect(value1).toBeTruthy();

      // 第二次应该从 L1 获取（已回填）
      const value2 = await service.get('key1');
      expect(value2).toBeTruthy();

      const stats = service.getStats();
      expect(stats.l1.hits).toBeGreaterThan(0);
    });
  });

  describe('Multi-Level Behavior', () => {
    it('should check L1 before L2', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);

      // 第一次获取（L1 命中）
      await service.get('key1');

      const stats = service.getStats();
      expect(stats.l1.hits).toBe(1);
      expect(stats.l2!.hits).toBe(0);
    });

    it('should fall back to L2 when L1 misses', async () => {
      // 直接写入 L2
      const docs = createDocs('value1');
      await mockRedis.set('cache:key1', JSON.stringify({ value: docs }));

      // 从 L2 获取
      const value = await service.get('key1');
      expect(value).toBeTruthy();

      const stats = service.getStats();
      expect(stats.l1.misses).toBe(1);
      expect(stats.l2!.hits).toBe(1);
    });
  });

  describe('Delete Operations', () => {
    it('should delete from both L1 and L2', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);
      await service.delete('key1');

      const value = await service.get('key1');
      expect(value).toBeNull();
    });

    it('should handle deleting non-existent keys', async () => {
      await expect(service.delete('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('Clear Operations', () => {
    it('should clear all caches', async () => {
      await service.set('key1', createDocs('value1'));
      await service.set('key2', createDocs('value2'));
      await service.set('key3', createDocs('value3'));

      await service.clear();

      expect(await service.get('key1')).toBeNull();
      expect(await service.get('key2')).toBeNull();
      expect(await service.get('key3')).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should track L1 hit rate', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);

      // 3 次命中
      await service.get('key1');
      await service.get('key1');
      await service.get('key1');

      // 1 次未命中
      await service.get('nonexistent');

      const stats = service.getStats();
      expect(stats.l1.hits).toBe(3);
      expect(stats.l1.misses).toBe(1);
      expect(stats.l1.hitRate).toBeCloseTo(0.75, 2);
    });

    it('should track L2 hit rate', async () => {
      // 直接写入 L2
      await mockRedis.set('cache:key1', JSON.stringify({ value: createDocs('value1') }));
      await mockRedis.set('cache:key2', JSON.stringify({ value: createDocs('value2') }));

      // L1 未命中，L2 命中
      await service.get('key1');
      await service.get('key2');

      // L1 和 L2 都未命中
      await service.get('nonexistent');

      const stats = service.getStats();
      expect(stats.l2!.hits).toBe(2);
      expect(stats.l2!.misses).toBe(1);
      expect(stats.l2!.hitRate).toBeCloseTo(0.67, 2);
    });

    it('should calculate overall hit rate', async () => {
      const docs = createDocs('value1');
      await service.set('key1', docs);

      // L1 命中
      await service.get('key1');
      await service.get('key1');

      // 清除 L1，从 L2 获取
      await service.clear();
      await service.set('key2', createDocs('value2'));
      await service.get('key2');

      // 完全未命中
      await service.get('nonexistent');

      const stats = service.getStats();
      expect(stats.overall.hitRate).toBeGreaterThan(0);
      expect(stats.overall.hitRate).toBeLessThan(1);
    });

    it('should track cache size', async () => {
      await service.set('key1', createDocs('value1'));
      await service.set('key2', createDocs('value2'));
      await service.set('key3', createDocs('value3'));

      const stats = service.getStats();
      expect(stats.l1.size).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document arrays', async () => {
      await service.set('empty', []);
      const value = await service.get('empty');
      expect(value).toEqual([]);
    });

    it('should handle very long keys', async () => {
      const longKey = 'a'.repeat(1000);
      const docs = createDocs('value');
      await service.set(longKey, docs);
      const value = await service.get(longKey);
      expect(value).toBeTruthy();
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key:with:colons:and:特殊字符';
      const docs = createDocs('value');
      await service.set(specialKey, docs);
      const value = await service.get(specialKey);
      expect(value).toBeTruthy();
    });

    it('should handle concurrent operations', async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(service.set(`key${i}`, createDocs(`value${i}`)));
      }

      await Promise.all(promises);

      const stats = service.getStats();
      expect(stats.l1.size).toBeLessThanOrEqual(100);
    });
  });
});
