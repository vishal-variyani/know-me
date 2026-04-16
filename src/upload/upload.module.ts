import { Module } from '@nestjs/common';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { UploadController } from './upload.controller.js';

@Module({
  imports: [ExtractionModule],
  controllers: [UploadController],
})
export class UploadModule {}
