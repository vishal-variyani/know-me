import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatModule } from './chat/chat.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { ExtractionModule } from './extraction/extraction.module.js';
import { MemoryModule } from './memory/memory.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: parseInt(config.getOrThrow<string>('REDIS_PORT'), 10),
        },
      }),
    }),
    DatabaseModule,
    EmbeddingModule,
    MemoryModule,
    ExtractionModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
