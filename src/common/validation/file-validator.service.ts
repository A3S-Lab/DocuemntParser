import { Injectable, Logger } from '@nestjs/common';
import { FileTooLargeError, UnsupportedFormatError } from '../errors/document.errors';
import { EXTENSION_TO_MIME } from '../../loaders/constants/mime-types';

/**
 * 文件验证配置
 */
export interface FileValidationConfig {
  /** 最大文件大小（字节） */
  maxSize?: number;
  /** 允许的 MIME 类型 */
  allowedMimeTypes?: string[];
  /** 允许的文件扩展名 */
  allowedExtensions?: string[];
  /** 是否严格验证 MIME 类型 */
  strictMimeValidation?: boolean;
}

/**
 * 文件验证结果
 */
export interface FileValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误信息 */
  errors?: string[];
  /** 文件信息 */
  fileInfo: {
    size: number;
    extension: string;
    mimeType?: string;
  };
}

/**
 * 文件验证服务
 */
@Injectable()
export class FileValidatorService {
  private readonly logger = new Logger(FileValidatorService.name);

  // 默认配置
  private readonly defaultConfig: FileValidationConfig = {
    maxSize: 100 * 1024 * 1024, // 100MB
    allowedExtensions: [
      'txt', 'md', 'markdown',
      'pdf',
      'doc', 'docx',
      'xls', 'xlsx',
      'html', 'htm',
      'json',
      'csv',
    ],
    strictMimeValidation: false,
  };


  /**
   * 验证文件
   */
  validate(
    buffer: Buffer,
    filename: string,
    config?: FileValidationConfig
  ): FileValidationResult {
    const mergedConfig = { ...this.defaultConfig, ...config };
    const errors: string[] = [];

    // 提取文件信息
    const extension = this.getExtension(filename);
    const size = buffer.length;
    const mimeType = this.getMimeType(extension);

    // 验证文件大小
    if (mergedConfig.maxSize && size > mergedConfig.maxSize) {
      const error = `文件过大: ${this.formatSize(size)} (最大: ${this.formatSize(mergedConfig.maxSize)})`;
      errors.push(error);
      this.logger.warn(error, { filename, size, maxSize: mergedConfig.maxSize });
    }

    // 验证文件扩展名
    if (mergedConfig.allowedExtensions && mergedConfig.allowedExtensions.length > 0) {
      if (!mergedConfig.allowedExtensions.includes(extension)) {
        const error = `不支持的文件格式: .${extension}`;
        errors.push(error);
        this.logger.warn(error, {
          filename,
          extension,
          allowedExtensions: mergedConfig.allowedExtensions,
        });
      }
    }

    // 验证 MIME 类型
    if (mergedConfig.allowedMimeTypes && mergedConfig.allowedMimeTypes.length > 0) {
      if (mimeType && !mergedConfig.allowedMimeTypes.includes(mimeType)) {
        const error = `不支持的 MIME 类型: ${mimeType}`;
        errors.push(error);
        this.logger.warn(error, {
          filename,
          mimeType,
          allowedMimeTypes: mergedConfig.allowedMimeTypes,
        });
      }
    }

    // 验证文件内容（魔数验证）
    if (mergedConfig.strictMimeValidation) {
      const detectedMimeType = this.detectMimeType(buffer);
      if (detectedMimeType && detectedMimeType !== mimeType) {
        const error = `文件内容与扩展名不匹配: 检测到 ${detectedMimeType}，但扩展名为 .${extension}`;
        errors.push(error);
        this.logger.warn(error, { filename, detectedMimeType, expectedMimeType: mimeType });
      }
    }

    const valid = errors.length === 0;

    if (valid) {
      this.logger.debug(`文件验证通过`, { filename, size, extension, mimeType });
    } else {
      this.logger.error(`文件验证失败`, { filename, errors });
    }

    return {
      valid,
      errors: errors.length > 0 ? errors : undefined,
      fileInfo: {
        size,
        extension,
        mimeType,
      },
    };
  }

  /**
   * 验证文件大小（抛出异常）
   */
  validateSize(buffer: Buffer, filename: string, maxSize: number): void {
    if (buffer.length > maxSize) {
      throw new FileTooLargeError(buffer.length, maxSize, { filename });
    }
  }

  /**
   * 验证文件格式（抛出异常）
   */
  validateFormat(filename: string, allowedExtensions: string[]): void {
    const extension = this.getExtension(filename);
    if (!allowedExtensions.includes(extension)) {
      throw new UnsupportedFormatError(extension, {
        filename,
        allowedExtensions,
      });
    }
  }

  /**
   * 批量验证文件
   */
  validateBatch(
    files: Array<{ buffer: Buffer; filename: string }>,
    config?: FileValidationConfig
  ): Array<FileValidationResult & { filename: string }> {
    return files.map(file => ({
      filename: file.filename,
      ...this.validate(file.buffer, file.filename, config),
    }));
  }

  /**
   * 获取文件扩展名
   */
  private getExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(extension: string): string | undefined {
    return EXTENSION_TO_MIME[`.${extension}`];
  }

  /**
   * 检测文件的实际 MIME 类型（通过魔数）
   */
  private detectMimeType(buffer: Buffer): string | undefined {
    if (buffer.length < 4) {
      return undefined;
    }

    // PDF
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'application/pdf';
    }

    // ZIP (DOCX, XLSX 都是 ZIP 格式)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      // 进一步检测是否是 Office 文档
      const content = buffer.toString('utf8', 0, Math.min(buffer.length, 1000));
      if (content.includes('word/')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      if (content.includes('xl/')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
      return 'application/zip';
    }

    // DOC (老版本 Word)
    if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
      return 'application/msword';
    }

    // HTML
    const htmlStart = buffer.toString('utf8', 0, Math.min(buffer.length, 100)).toLowerCase();
    if (htmlStart.includes('<!doctype html') || htmlStart.includes('<html')) {
      return 'text/html';
    }

    // JSON
    const jsonStart = buffer.toString('utf8', 0, Math.min(buffer.length, 10)).trim();
    if (jsonStart.startsWith('{') || jsonStart.startsWith('[')) {
      return 'application/json';
    }

    // 默认为文本
    return 'text/plain';
  }

  /**
   * 格式化文件大小
   */
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
