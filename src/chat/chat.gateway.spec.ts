import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway.js';
import { LlmService } from '../llm/llm.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import type { Socket } from 'socket.io';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockLlmService: {
    streamResponse: ReturnType<typeof vi.fn>;
  };
  let mockRetrievalService: {
    retrieve: ReturnType<typeof vi.fn>;
  };
  let mockMemoryService: {
    createConversation: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    getRecentMessages: ReturnType<typeof vi.fn>;
  };
  let mockExtractionService: {
    enqueue: ReturnType<typeof vi.fn>;
  };

  const validUserId = 'a0000000-0000-0000-0000-000000000000';

  function makeSocket(userId: string = validUserId): Partial<Socket> {
    return {
      id: 'socket-1',
      handshake: { auth: { userId } } as Socket['handshake'],
      emit: vi.fn(),
    };
  }

  beforeEach(async () => {
    mockLlmService = {
      streamResponse: vi.fn().mockImplementation(async function* () {
        yield 'Hello';
        yield ' world';
      }),
    };
    mockRetrievalService = {
      retrieve: vi.fn().mockResolvedValue({ memories: [], chunks: [], people: [] }),
    };
    mockMemoryService = {
      createConversation: vi.fn().mockResolvedValue({ id: 'conv-1' }),
      addMessage: vi.fn().mockResolvedValue(undefined),
      getRecentMessages: vi.fn().mockResolvedValue([]),
    };
    mockExtractionService = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: LlmService, useValue: mockLlmService },
        { provide: RetrievalService, useValue: mockRetrievalService },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: ExtractionService, useValue: mockExtractionService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('afterInit — UUID validation middleware', () => {
    it('calls next(Error) when userId is not a valid UUID', () => {
      const mockServer = { use: vi.fn() };
      gateway.afterInit(mockServer as never);

      expect(mockServer.use).toHaveBeenCalledTimes(1);
      const middleware = mockServer.use.mock.calls[0][0] as (
        socket: { handshake: { auth: Record<string, unknown> } },
        next: (err?: Error) => void,
      ) => void;

      const nextFn = vi.fn();
      middleware({ handshake: { auth: { userId: 'not-a-uuid' } } }, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls next() with no args when userId is a valid UUID', () => {
      const mockServer = { use: vi.fn() };
      gateway.afterInit(mockServer as never);

      const middleware = mockServer.use.mock.calls[0][0] as (
        socket: { handshake: { auth: Record<string, unknown> } },
        next: (err?: Error) => void,
      ) => void;

      const nextFn = vi.fn();
      middleware({ handshake: { auth: { userId: validUserId } } }, nextFn);
      expect(nextFn).toHaveBeenCalledWith(); // no error argument
    });
  });

  describe('handleChatSend — streaming loop', () => {
    it('emits chat:chunk for each token and chat:complete after stream', async () => {
      const client = makeSocket();
      gateway.handleConnection(client as Socket);

      await gateway.handleChatSend(client as Socket, { message: 'I had lunch with Sarah' });

      const emitMock = client.emit as ReturnType<typeof vi.fn>;
      const chunkCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:chunk',
      );
      const completeCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:complete',
      );

      expect(chunkCalls).toHaveLength(2);
      expect(chunkCalls[0][1]).toEqual({ token: 'Hello' });
      expect(chunkCalls[1][1]).toEqual({ token: ' world' });
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0][1]).toEqual({ conversationId: 'conv-1' });
    });
  });

  describe('handleChatSend — non-extractable message short-circuit', () => {
    it('emits chat:complete without streaming when classifier says shouldExtract=false', async () => {
      const client = makeSocket();
      gateway.handleConnection(client as Socket);

      await gateway.handleChatSend(client as Socket, { message: 'Hello' });

      const emitMock = client.emit as ReturnType<typeof vi.fn>;
      const chunkCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:chunk',
      );
      const completeCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:complete',
      );

      expect(chunkCalls).toHaveLength(0);
      expect(completeCalls).toHaveLength(1);
      expect(mockLlmService.streamResponse).not.toHaveBeenCalled();
      expect(mockExtractionService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect — AbortController lifecycle', () => {
    it('calls abort() and deletes the controller on disconnect', () => {
      const client = makeSocket();
      gateway.handleConnection(client as Socket);

      const abortControllers = (
        gateway as unknown as Record<string, Map<string, AbortController>>
      )['abortControllers'];
      const ctrl = abortControllers.get('socket-1')!;
      const abortSpy = vi.spyOn(ctrl, 'abort');

      gateway.handleDisconnect(client as Socket);

      expect(abortSpy).toHaveBeenCalledTimes(1);
      expect(abortControllers.has('socket-1')).toBe(false);
    });
  });

  describe('handleChatSend — fire-and-forget extraction', () => {
    it('emits chat:complete even when enqueue never resolves', async () => {
      // Make enqueue return a Promise that never settles
      mockExtractionService.enqueue.mockReturnValue(new Promise(() => {}));

      const client = makeSocket();
      gateway.handleConnection(client as Socket);

      await gateway.handleChatSend(client as Socket, { message: 'I had lunch with Sarah' });

      const emitMock = client.emit as ReturnType<typeof vi.fn>;
      const completeCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:complete',
      );
      expect(completeCalls).toHaveLength(1);
      expect(mockExtractionService.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleChatSend — AbortError silenced', () => {
    it('does not emit chat:error when streamResponse throws AbortError', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      mockLlmService.streamResponse = vi.fn().mockImplementation(async function* () {
        throw abortErr;
      });

      const client = makeSocket();
      gateway.handleConnection(client as Socket);

      await gateway.handleChatSend(client as Socket, { message: 'test' });

      const emitMock = client.emit as ReturnType<typeof vi.fn>;
      const errorCalls = emitMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'chat:error',
      );
      expect(errorCalls).toHaveLength(0);
    });
  });
});
