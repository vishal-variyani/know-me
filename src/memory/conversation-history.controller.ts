import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Controller('conversations')
export class ConversationHistoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get(':conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('userId') userId: string,
    @Query('limit') limitRaw?: string,
    @Query('beforeCreatedAt') beforeCreatedAtRaw?: string,
    @Query('beforeId') beforeId?: string,
  ): Promise<{
    messages: {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      createdAt: string;
    }[];
    pagination: {
      hasMore: boolean;
      nextCursor: { beforeCreatedAt: string; beforeId: string } | null;
    };
  }> {
    if (!UUID_REGEX.test(conversationId)) {
      throw new BadRequestException('conversationId must be a valid UUID');
    }
    if (typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
      throw new BadRequestException('userId must be a valid UUID');
    }

    const parsedLimit =
      typeof limitRaw === 'string' && limitRaw.trim().length > 0
        ? Number.parseInt(limitRaw, 10)
        : DEFAULT_LIMIT;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }

    let beforeCreatedAt: Date | undefined;
    if (beforeCreatedAtRaw !== undefined) {
      const parsed = new Date(beforeCreatedAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('beforeCreatedAt must be a valid ISO timestamp');
      }
      beforeCreatedAt = parsed;
      if (!beforeId || !UUID_REGEX.test(beforeId)) {
        throw new BadRequestException('beforeId must be a valid UUID when beforeCreatedAt is provided');
      }
    }

    const result = await this.memoryService.getConversationHistoryPage(
      conversationId,
      userId,
      parsedLimit,
      beforeCreatedAt,
      beforeId,
    );

    return {
      messages: result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at.toISOString(),
      })),
      pagination: {
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      },
    };
  }
}
