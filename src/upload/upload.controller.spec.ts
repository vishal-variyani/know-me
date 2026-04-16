import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { UploadController } from './upload.controller.js';
import { ExtractionService } from '../extraction/extraction.service.js';

describe('UploadController', () => {
  let controller: UploadController;
  let mockExtractionService: { enqueue: ReturnType<typeof vi.fn> };

  const validUserId = 'a0000000-0000-0000-0000-000000000000';

  function makeFile(
    originalname: string,
    mimetype: string,
    buffer: Buffer,
  ): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype,
      size: buffer.length,
      buffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as unknown as NodeJS.ReadableStream,
    };
  }

  beforeEach(async () => {
    mockExtractionService = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        { provide: ExtractionService, useValue: mockExtractionService },
      ],
    }).compile();

    controller = module.get<UploadController>(UploadController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /upload — happy paths', () => {
    it('accepts valid .txt file with valid UUID and calls enqueue once with document', async () => {
      const file = makeFile('notes.txt', 'text/plain', Buffer.from('Hello world'));
      const result = await controller.uploadDocument(validUserId, file);

      expect(result).toEqual({ status: 'accepted' });
      expect(mockExtractionService.enqueue).toHaveBeenCalledTimes(1);
      expect(mockExtractionService.enqueue).toHaveBeenCalledWith(
        'Hello world',
        validUserId,
        'document',
      );
    });

    it('accepts valid .md file with valid UUID and calls enqueue once', async () => {
      const file = makeFile(
        'journal.md',
        'text/markdown',
        Buffer.from('## Today\nDid things'),
      );
      const result = await controller.uploadDocument(validUserId, file);

      expect(result).toEqual({ status: 'accepted' });
      expect(mockExtractionService.enqueue).toHaveBeenCalledTimes(1);
      expect(mockExtractionService.enqueue).toHaveBeenCalledWith(
        '## Today\nDid things',
        validUserId,
        'document',
      );
    });
  });

  describe('POST /upload — validation failures', () => {
    it('throws 400 when userId is missing', async () => {
      const file = makeFile('notes.txt', 'text/plain', Buffer.from('content'));

      await expect(
        controller.uploadDocument(undefined as unknown as string, file),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 400 when userId is not a valid UUID', async () => {
      const file = makeFile('notes.txt', 'text/plain', Buffer.from('content'));

      await expect(
        controller.uploadDocument('not-a-uuid', file),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 400 when file is missing', async () => {
      await expect(
        controller.uploadDocument(validUserId, undefined as unknown as Express.Multer.File),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 415 when file has unsupported extension (.pdf)', async () => {
      const file = makeFile(
        'document.pdf',
        'application/pdf',
        Buffer.from('PDF content'),
      );

      await expect(
        controller.uploadDocument(validUserId, file),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 415 when file has unsupported extension even with text mime', async () => {
      const file = makeFile(
        'file.csv',
        'text/plain',
        Buffer.from('col1,col2'),
      );

      await expect(
        controller.uploadDocument(validUserId, file),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 400 when file content is empty after trimming', async () => {
      const file = makeFile('notes.txt', 'text/plain', Buffer.from('   '));

      await expect(
        controller.uploadDocument(validUserId, file),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('throws 400 when file buffer is empty', async () => {
      const file = makeFile('notes.txt', 'text/plain', Buffer.alloc(0));

      await expect(
        controller.uploadDocument(validUserId, file),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('file size validation', () => {
    it('throws 400 when file exceeds 50KB', async () => {
      // 51KB of content
      const bigContent = Buffer.alloc(51 * 1024, 'a');
      const file = makeFile('large.txt', 'text/plain', bigContent);

      await expect(
        controller.uploadDocument(validUserId, file),
      ).rejects.toThrow(BadRequestException);
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });

    it('accepts file exactly at 50KB limit', async () => {
      const exactContent = Buffer.alloc(50 * 1024, 'a');
      const file = makeFile('limit.txt', 'text/plain', exactContent);

      const result = await controller.uploadDocument(validUserId, file);
      expect(result).toEqual({ status: 'accepted' });
    });
  });
});
