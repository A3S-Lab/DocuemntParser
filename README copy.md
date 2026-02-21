# @nestify/document

NestJS 企业级文档处理模块，提供多格式文档加载、文本分割、缓存、限流、熔断、监控和断点续传等能力。专为 RAG（检索增强生成）和 AI 应用场景设计。

## 特性

- 📄 **多格式支持** — PDF、Word（DOCX/DOC）、Excel（XLSX）、HTML、Markdown、CSV、JSON、TXT
- 🔍 **智能 PDF 处理** — 自动检测扫描版 PDF，无缝切换 OCR 识别
- ✂️ **文本分割** — 递归字符分割、Markdown/HTML 标题分割、Token 分割、JSON 结构分割
- 🚀 **生产就绪** — 熔断器、限流、多级缓存（内存 + Redis）、文件验证
- 📊 **可观测性** — 性能监控（P50/P95/P99）、健康检查、慢操作检测
- 🔄 **断点续传** — Redis 持久化任务状态，支持分页处理和任务恢复
- 🧩 **处理器管道** — 可插拔的文档处理管道（清洗、元数据增强、分块控制）

## 安装

```bash
npm install @nestify/document
```

Peer 依赖：

```bash
npm install @nestjs/common
```

## 快速开始

### 基础用法

```typescript
import { Module } from '@nestjs/common';
import { DocumentModule } from '@nestify/document';

@Module({
  imports: [
    DocumentModule.register(),
  ],
})
export class AppModule {}
```

```typescript
import { Injectable } from '@nestjs/common';
import { DocumentService } from '@nestify/document';

@Injectable()
export class MyService {
  constructor(private readonly documentService: DocumentService) {}

  async processFile(buffer: Buffer, filename: string) {
    const docs = await this.documentService.processBuffer(buffer, filename);
    // docs: Document[] — 每个 Document 包含 pageContent 和 metadata
    return docs;
  }
}
```

### 完整配置

```typescript
DocumentModule.register({
  // 缓存
  enableCache: true,
  cacheTTL: 3600000,              // 1 小时
  cacheStrategy: 'multi-level',   // 'memory' | 'multi-level'
  multiLevelCache: {
    l1TTL: 300000,                // L1 内存缓存 5 分钟
    l2TTL: 3600000,               // L2 Redis 缓存 1 小时
    l1MaxSize: 200,
  },

  // Redis（启用多级缓存、任务管理、健康检查）
  redis: redisClient,             // 实现 IRedisClient 接口

  // OCR（扫描版 PDF 识别）
  ocrService: ocrService,         // 实现 IOCRService 接口
  autoDetectScannedPdf: true,
  defaultOcrPrompt: '请识别图片中的文字',

  // 处理器管道
  processors: [
    new TextCleanerProcessor(),
    new MetadataEnricherProcessor(),
    new ChunkSizeControlProcessor({ maxChunkSize: 2000 }),
  ],

  // 限流
  rateLimit: {
    maxRequests: 100,
    windowMs: 60000,
    algorithm: 'sliding_window',  // 'token_bucket' | 'sliding_window' | 'fixed_window'
  },

  // 熔断器
  circuitBreaker: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    resetTimeout: 60000,
  },

  // 文件验证
  fileValidation: {
    maxSize: 50 * 1024 * 1024,    // 50MB
    allowedExtensions: ['pdf', 'docx', 'xlsx', 'html', 'md', 'csv', 'json', 'txt'],
    strictMimeValidation: false,
  },

  // 批处理
  batchProcessing: {
    concurrency: 5,
    continueOnError: true,
  },

  // 监控
  monitoring: {
    enableDetailedMetrics: true,
    slowOperationThreshold: 5000,
    maxMetrics: 10000,
  },
})
```

### 异步注册

```typescript
DocumentModule.registerAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    enableCache: true,
    cacheStrategy: 'multi-level',
    redis: config.get('redisClient'),
  }),
  inject: [ConfigService],
})
```

## 文档加载器

### 独立使用（不依赖 NestJS）

所有加载器可独立使用，无需注入 NestJS 模块：

```typescript
import {
  TextLoader,
  MarkdownLoader,
  PDFLoader,
  HTMLLoader,
  JSONLoader,
  CSVLoader,
  DocxLoader,
  XLSXLoader,
  DirectoryLoader,
} from '@nestify/document';

// 加载文本文件
const textDocs = await new TextLoader('readme.txt').load();

// 加载 PDF（自动检测扫描版）
const pdfDocs = await new PDFLoader('report.pdf').load();

// 加载 Word 文档（自动降级：markitdown-ts → mammoth）
const docxDocs = await new DocxLoader('document.docx').load();

// 加载 Excel（自动降级：markitdown-ts → xlsx）
const xlsxDocs = await new XLSXLoader('data.xlsx').load();

// 加载 HTML（自动降级：Turndown Markdown → 正则提取）
const htmlDocs = await new HTMLLoader('page.html').load();

// 加载 JSON（支持 JSON Pointer 提取嵌套字段）
const jsonDocs = await new JSONLoader('data.json', { jsonPointer: '/messages/*/content' }).load();

// 加载 CSV
const csvDocs = await new CSVLoader('data.csv', { column: 'content' }).load();

// 批量加载目录
const dirDocs = await new DirectoryLoader('./docs', {
  glob: '**/*.{pdf,docx,md}',
  recursive: true,
  showProgress: true,
}).load();
```

### 支持的格式

| 格式 | 加载器 | 输出格式 | 依赖 |
|------|--------|----------|------|
| `.txt` | `TextLoader` | 纯文本 | — |
| `.md` | `MarkdownLoader` | Markdown | — |
| `.pdf` | `PDFLoader` | 文本 / Markdown | `pdf-parse`；OCR 可选 |
| `.html` `.htm` | `HTMLLoader` | Markdown / 纯文本 | `turndown`（内置） |
| `.json` | `JSONLoader` | 纯文本 | — |
| `.csv` | `CSVLoader` | 纯文本 | `papaparse`（内置） |
| `.docx` `.doc` | `DocxLoader` | Markdown / 纯文本 | `markitdown-ts`；`mammoth` / `word-extractor`（降级） |
| `.xlsx` `.xls` | `XLSXLoader` | Markdown 表格 / CSV | `markitdown-ts`；`xlsx`（降级） |
| 目录 | `DirectoryLoader` | 混合 | `glob` |

### 懒加载

所有加载器支持 `lazyLoad()` 逐文档 yield，适合大文件或大批量场景：

```typescript
const loader = new DirectoryLoader('./docs', { glob: '**/*.pdf' });

for await (const doc of loader.lazyLoad()) {
  // 逐个处理，不会一次性加载所有文档到内存
  await processDocument(doc);
}
```

## 文本分割器

```typescript
import {
  RecursiveCharacterTextSplitter,
  CharacterTextSplitter,
  TokenTextSplitter,
  MarkdownHeaderTextSplitter,
  HTMLHeaderTextSplitter,
  RecursiveJsonSplitter,
} from '@nestify/document';

// 递归字符分割（推荐通用场景）
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
const chunks = await splitter.splitDocuments(docs);

// 按编程语言分割
const jsSplitter = RecursiveCharacterTextSplitter.fromLanguage('js', {
  chunkSize: 2000,
});

// Markdown 标题分割
const mdSplitter = new MarkdownHeaderTextSplitter({
  headersToSplitOn: [
    ['#', 'h1'],
    ['##', 'h2'],
    ['###', 'h3'],
  ],
});

// HTML 标题分割
const htmlSplitter = new HTMLHeaderTextSplitter({
  headersToSplitOn: [
    ['h1', 'Header 1'],
    ['h2', 'Header 2'],
  ],
});

// JSON 结构分割
const jsonSplitter = new RecursiveJsonSplitter({ maxChunkSize: 2000 });

// 加载并分割（一步完成）
const results = await new PDFLoader('report.pdf').loadAndSplit(splitter);
```

### 支持的编程语言

`RecursiveCharacterTextSplitter.fromLanguage()` 支持：

`cpp` · `go` · `java` · `js` · `php` · `proto` · `python` · `rst` · `ruby` · `rust` · `scala` · `swift` · `markdown` · `latex` · `html` · `sol`

## 处理器管道

处理器按顺序对文档进行后处理：

```typescript
import {
  TextCleanerProcessor,
  MetadataEnricherProcessor,
  MarkdownSplitterProcessor,
  ChunkSizeControlProcessor,
} from '@nestify/document';

DocumentModule.register({
  processors: [
    // 1. 清洗文本（去除多余空白、特殊字符等）
    new TextCleanerProcessor(),

    // 2. 增强元数据（添加字数、摘要等）
    new MetadataEnricherProcessor(),

    // 3. Markdown 分割
    new MarkdownSplitterProcessor({ chunkSize: 1500 }),

    // 4. 分块大小控制
    new ChunkSizeControlProcessor({ maxChunkSize: 2000 }),
  ],
})
```

自定义处理器：

```typescript
import { IDocumentProcessor, Document } from '@nestify/document';

class MyProcessor implements IDocumentProcessor {
  name = 'MyProcessor';

  async process(documents: Document[]): Promise<Document[]> {
    return documents.map(doc => new Document({
      pageContent: doc.pageContent.toLowerCase(),
      metadata: { ...doc.metadata, processed: true },
    }));
  }
}
```

## 通过 DocumentService 处理

### 单文件处理

```typescript
const docs = await documentService.processBuffer(buffer, 'report.pdf');
```

### 批量处理

```typescript
const results = await documentService.processBuffers([
  { buffer: pdfBuffer, filename: 'report.pdf' },
  { buffer: docxBuffer, filename: 'document.docx' },
  { buffer: csvBuffer, filename: 'data.csv' },
]);
// results: Document[][] — 每个文件对应一组 Document
```

### 流式处理

```typescript
for await (const doc of documentService.streamProcessBuffers(files)) {
  // 逐文档处理，内存友好
  await indexToVectorStore(doc);
}
```

## 任务管理与断点续传

需要 Redis 支持：

```typescript
import { DocumentTaskService } from '@nestify/document';

@Injectable()
class PdfProcessingService {
  constructor(private readonly taskService: DocumentTaskService) {}

  async processScannedPdf(taskId: string, buffer: Buffer) {
    const result = await this.taskService.processWithPagination(
      taskId,
      buffer,
      'scanned.pdf',
      async (pageBuffer, pageIndex) => {
        // 处理单页
        return { text: await ocrPage(pageBuffer, pageIndex) };
      },
      {
        onPageSuccess: (id, result) => {
          console.log(`Page ${result.pageIndex} done`);
        },
      },
    );

    return result; // DocumentTaskResult
  }

  async checkProgress(taskId: string) {
    return this.taskService.getTaskProgress(taskId);
    // { total, completed, failed, percentage, status }
  }

  async resumeTask(taskId: string, buffer: Buffer) {
    // 自动跳过已完成的页面
    return this.taskService.processWithPagination(taskId, buffer, 'scanned.pdf', processor);
  }
}
```

## 接口定义

### IRedisClient

```typescript
interface IRedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<void>;
  eval(script: string, numkeys: number, ...args: any[]): Promise<any>;
  scanKeys?(pattern: string): Promise<string[]>;  // 推荐实现，避免 KEYS 阻塞
}
```

### IOCRService

```typescript
interface IOCRService {
  processDocument(
    taskId: string,
    input: { pdfBuffer: Buffer },
    options?: { processOnlyPages?: number[]; ocrPrompt?: string },
    callbacks?: {
      onPageSuccess?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
      onPageFailed?: (taskId: string, result: IOCRPageResult) => void | Promise<void | boolean>;
    },
  ): Promise<IOCRResult>;

  getPageResults?(taskId: string, pageIndices: number[]): Promise<IOCRPageResult[]>;
  healthCheck?(): Promise<void>;
}
```

## 错误处理

模块提供结构化的错误层次：

```typescript
import {
  DocumentError,           // 基类，包含 code 和 details
  UnsupportedFormatError,  // 不支持的文件格式
  FileTooLargeError,       // 文件超过大小限制
  ConfigValidationError,   // 模块配置验证失败
  RateLimitError,          // 触发限流
  CircuitBreakerError,     // 熔断器打开
  DocumentValidationError, // 文件验证失败
  DocumentLoadError,       // 文档加载失败
} from '@nestify/document';

try {
  await documentService.processBuffer(buffer, filename);
} catch (error) {
  if (error instanceof FileTooLargeError) {
    // error.code === 'FILE_TOO_LARGE'
    // error.details.size, error.details.maxSize
  }
  if (error instanceof RateLimitError) {
    // 稍后重试
  }
}
```

## 装饰器

提供方法级装饰器，可用于自定义服务：

```typescript
import { Monitor, HandleErrors, Retry, RateLimit, CircuitBreak, Resilient } from '@nestify/document';

class MyService {
  @Monitor('myOperation')           // 自动记录性能指标
  @HandleErrors('MyService')        // 统一错误处理
  @Retry(3, 1000)                   // 失败重试 3 次，间隔 1s
  @RateLimit('api', 100, 60000)     // 限流：60s 内最多 100 次
  @CircuitBreak('external-api')     // 熔断保护
  async callExternalApi() { ... }

  @Resilient('critical-op', {       // 组合：熔断 + 限流 + 监控
    circuitBreaker: { failureThreshold: 3 },
    rateLimit: { maxRequests: 50, windowMs: 60000 },
  })
  async criticalOperation() { ... }
}
```

## 健康检查

需要 Redis 支持：

```typescript
import { DocumentHealthService } from '@nestify/document';

@Injectable()
class HealthController {
  constructor(private readonly health: DocumentHealthService) {}

  async check() {
    const result = await this.health.check();
    // {
    //   status: 'UP' | 'DOWN' | 'DEGRADED',
    //   details: {
    //     module: { status, message },
    //     redis: { status, message, latency },
    //     ocr: { status, message },
    //   }
    // }
    return result;
  }
}
```

## 项目结构

```
src/
├── document.module.ts              # NestJS 动态模块
├── document.service.ts             # 核心服务
├── document-module-options.interface.ts
├── models/
│   └── document.model.ts           # Document 数据模型
├── loaders/                        # 文档加载器
│   ├── base/                       # 抽象基类
│   ├── parsers/                    # PDF/Markdown 解析器
│   ├── constants/                  # MIME 类型映射
│   └── *.loader.ts                 # 各格式加载器
├── splitters/                      # 文本分割器
├── processors/                     # 处理器管道
├── progress/                       # 任务管理与断点续传
└── common/
    ├── interfaces/                 # 公共接口
    ├── cache/                      # 缓存服务
    ├── resilience/                 # 熔断器 & 限流
    ├── monitoring/                 # 性能监控
    ├── health/                     # 健康检查
    ├── validation/                 # 配置 & 文件验证
    ├── errors/                     # 错误类型
    └── decorators/                 # 方法装饰器
```

## 依赖说明

| 依赖 | 用途 | 必需 |
|------|------|------|
| `pdf-parse` | PDF 文本提取 | ✅ |
| `markitdown-ts` | 文档转 Markdown（PDF/DOCX/XLSX） | ✅ |
| `papaparse` | CSV 解析 | ✅ |
| `cheerio` | HTML 标题分割 | ✅ |
| `turndown` + `turndown-plugin-gfm` | HTML 转 Markdown | ✅ |
| `mammoth` | DOCX 纯文本提取（降级方案） | ✅ |
| `word-extractor` | DOC 纯文本提取（降级方案） | ✅ |
| `xlsx` | Excel 解析（降级方案） | ✅ |
| `glob` | 目录文件匹配 | ✅ |
| `zod` | 配置验证 | ✅ |

## License

MIT
