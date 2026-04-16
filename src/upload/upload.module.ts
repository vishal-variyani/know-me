import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module.js';
import { UploadController } from './upload.controller.js';

@Module({
  imports: [DocumentModule],
  controllers: [UploadController],
})
export class UploadModule {}
