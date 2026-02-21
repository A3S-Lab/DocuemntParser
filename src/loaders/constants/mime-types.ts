/**
 * 常见 MIME 类型
 */
export const MIME_TYPES = {
  TEXT: {
    PLAIN: 'text/plain',
    HTML: 'text/html',
    CSS: 'text/css',
    JAVASCRIPT: 'text/javascript',
    MARKDOWN: 'text/markdown',
    CSV: 'text/csv',
  },
  DOCUMENT: {
    PDF: 'application/pdf',
    DOC: 'application/msword',
    DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  SPREADSHEET: {
    XLS: 'application/vnd.ms-excel',
    XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    CSV: 'text/csv',
  },
  DATA: {
    JSON: 'application/json',
    JSONL: 'application/json',
    XML: 'application/xml',
    YAML: 'application/x-yaml',
  },
  IMAGE: {
    JPEG: 'image/jpeg',
    PNG: 'image/png',
    GIF: 'image/gif',
    TIFF: 'image/tiff',
    SVG: 'image/svg+xml',
    WEBP: 'image/webp',
  },
  OTHER: {
    ZIP: 'application/zip',
    OCTET_STREAM: 'application/octet-stream',
  },
} as const;

/**
 * 文件扩展名到 MIME 类型的映射
 */
export const EXTENSION_TO_MIME: Record<string, string> = {
  // 文本
  '.txt': MIME_TYPES.TEXT.PLAIN,
  '.html': MIME_TYPES.TEXT.HTML,
  '.htm': MIME_TYPES.TEXT.HTML,
  '.css': MIME_TYPES.TEXT.CSS,
  '.js': MIME_TYPES.TEXT.JAVASCRIPT,
  '.md': MIME_TYPES.TEXT.MARKDOWN,
  '.markdown': MIME_TYPES.TEXT.MARKDOWN,
  '.csv': MIME_TYPES.TEXT.CSV,

  // JSON
  '.json': MIME_TYPES.DATA.JSON,
  '.jsonl': MIME_TYPES.DATA.JSONL,

  // Office
  '.doc': MIME_TYPES.DOCUMENT.DOC,
  '.docx': MIME_TYPES.DOCUMENT.DOCX,
  '.xls': MIME_TYPES.SPREADSHEET.XLS,
  '.xlsx': MIME_TYPES.SPREADSHEET.XLSX,

  // PDF
  '.pdf': MIME_TYPES.DOCUMENT.PDF,

  // 图片
  '.jpg': MIME_TYPES.IMAGE.JPEG,
  '.jpeg': MIME_TYPES.IMAGE.JPEG,
  '.png': MIME_TYPES.IMAGE.PNG,
  '.gif': MIME_TYPES.IMAGE.GIF,
  '.svg': MIME_TYPES.IMAGE.SVG,
  '.webp': MIME_TYPES.IMAGE.WEBP,
};

/**
 * MIME 类型到文件扩展名的映射
 */
export const MIME_TO_EXTENSION: Record<string, string> = Object.entries(
  EXTENSION_TO_MIME
).reduce((acc, [ext, mime]) => {
  if (!acc[mime]) {
    acc[mime] = ext;
  }
  return acc;
}, {} as Record<string, string>);
