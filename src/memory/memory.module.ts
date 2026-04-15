import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service.js';
import { PeopleService } from './people.service.js';

@Module({
  providers: [MemoryService, PeopleService],
  exports: [MemoryService, PeopleService],
})
export class MemoryModule {}
