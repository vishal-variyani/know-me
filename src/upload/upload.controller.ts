import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  UnsupportedMediaTypeException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ExtractionService } from '../extraction/extraction.service.js';
import type { UploadAcceptedResponse } from './upload.types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const MAX_FILE_BYTES = 50 * 1024; // 50 KB

@Controller()
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly extractionService: ExtractionService) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Body('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadAcceptedResponse> {
    // 1. Validate userId before anything else (T-05-01-02)
    if (
      typeof userId !== 'string' ||
      !userId.trim() ||
      !UUID_REGEX.test(userId)
    ) {
      throw new BadRequestException(
        'userId is required and must be a valid UUID v4',
      );
    }

    // 2. Validate file is present
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // 3. Validate file extension (T-05-01-01 — validate both extension and mime)
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type "${ext}". Only .txt and .md files are accepted`,
      );
    }

    // 4. Validate file size (T-05-01-03 — DoS mitigation)
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException(
        `File exceeds maximum size of 50 KB (received ${file.size} bytes)`,
      );
    }

    // 5. Decode buffer as UTF-8 and trim; reject empty content
    const text = file.buffer.toString('utf-8').trim();
    if (!text) {
      throw new BadRequestException('File content must not be empty');
    }

    // 6. Enqueue for extraction (fire-and-forget — endpoint does not wait for pipeline)
    await this.extractionService.enqueue(text, userId, 'document');
    this.logger.log(
      `Enqueued document extraction userId=${userId} ext=${ext} contentLen=${text.length}`,
    );

    return { status: 'accepted' };
  }
}
