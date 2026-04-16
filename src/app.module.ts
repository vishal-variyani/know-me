import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatModule } from './chat/chat.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EmbeddingModule } from './embedding/embedding.module.js';
import { MemoryModule } from './memory/memory.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // makes ConfigService injectable everywhere without re-importing
    }),
    DatabaseModule,
    EmbeddingModule,
    MemoryModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
