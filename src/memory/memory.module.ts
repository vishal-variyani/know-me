import { Module } from '@nestjs/common';
import { ConversationHistoryController } from './conversation-history.controller.js';
import { MemoryService } from './memory.service.js';
import { PeopleService } from './people.service.js';

@Module({
  controllers: [ConversationHistoryController],
  providers: [MemoryService, PeopleService],
  exports: [MemoryService, PeopleService],
})
export class MemoryModule {}
