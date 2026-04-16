import { Test, TestingModule } from '@nestjs/testing';
import { ConversationHistoryController } from './conversation-history.controller.js';
import { MemoryService } from './memory.service.js';

describe('ConversationHistoryController', () => {
  let controller: ConversationHistoryController;
  let mockMemoryService: {
    getConversationHistoryPage: ReturnType<typeof vi.fn>;
  };

  const conversationId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const cursorId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    mockMemoryService = {
      getConversationHistoryPage: vi.fn().mockResolvedValue({
        messages: [
          {
            id: cursorId,
            conversation_id: conversationId,
            user_id: userId,
            role: 'user' as const,
            content: 'hello',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        hasMore: true,
        nextCursor: {
          beforeCreatedAt: '2026-01-01T00:00:00.000Z',
          beforeId: cursorId,
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationHistoryController],
      providers: [{ provide: MemoryService, useValue: mockMemoryService }],
    }).compile();

    controller = module.get<ConversationHistoryController>(
      ConversationHistoryController,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated messages and pagination cursor', async () => {
    const response = await controller.getMessages(conversationId, userId, '20');

    expect(mockMemoryService.getConversationHistoryPage).toHaveBeenCalledWith(
      conversationId,
      userId,
      20,
      undefined,
      undefined,
    );
    expect(response.messages).toEqual([
      {
        id: cursorId,
        role: 'user',
        content: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(response.pagination.hasMore).toBe(true);
    expect(response.pagination.nextCursor).toEqual({
      beforeCreatedAt: '2026-01-01T00:00:00.000Z',
      beforeId: cursorId,
    });
  });

  it('passes keyset cursor params when provided', async () => {
    await controller.getMessages(
      conversationId,
      userId,
      '10',
      '2026-01-01T00:00:00.000Z',
      cursorId,
    );

    expect(mockMemoryService.getConversationHistoryPage).toHaveBeenCalledWith(
      conversationId,
      userId,
      10,
      new Date('2026-01-01T00:00:00.000Z'),
      cursorId,
    );
  });

  it('throws for invalid userId', async () => {
    await expect(
      controller.getMessages(conversationId, 'not-uuid', '20'),
    ).rejects.toThrow(/userId must be a valid UUID/);
  });

  it('throws for invalid limit', async () => {
    await expect(
      controller.getMessages(conversationId, userId, '0'),
    ).rejects.toThrow(/limit must be an integer between 1 and 100/);
  });
});
