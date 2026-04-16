import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { LlmService } from '../llm/llm.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import type { MemoryContext } from '../retrieval/retrieval.types.js';
import type {
  ConversationMessageRow,
  MemorySearchResult,
  PersonRow,
} from '../memory/memory.types.js';
import type {
  ChatSendPayload,
  ChatChunkPayload,
  ChatCompletePayload,
  ChatErrorPayload,
} from './chat.types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_LIMIT = 10; // D-02: hard-coded constant for v1
const MEMORY_THRESHOLD = 0.7; // D-03: similarity threshold for memory injection

@WebSocketGateway()
@Injectable()
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly conversationIds = new Map<string, string>();

  constructor(
    private readonly llmService: LlmService,
    private readonly retrievalService: RetrievalService,
    private readonly memoryService: MemoryService,
    private readonly extractionService: ExtractionService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket: Socket, next) => {
      const userId = socket.handshake.auth['userId'] as unknown;
      if (typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
        next(new Error('Invalid userId: must be a valid UUID'));
        return;
      }
      next();
    });
    this.logger.log('ChatGateway initialized — UUID validation middleware registered');
  }

  handleConnection(client: Socket): void {
    // Register AbortController FIRST before any async work (Pitfall 3 avoidance)
    this.abortControllers.set(client.id, new AbortController());
    const userId = client.handshake.auth['userId'] as string;
    this.logger.log(`Client connected: ${client.id} userId=${userId}`);
  }

  handleDisconnect(client: Socket): void {
    const ctrl = this.abortControllers.get(client.id);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(client.id);
    }
    this.conversationIds.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatSendPayload,
  ): Promise<void> {
    const userId = client.handshake.auth['userId'] as string;
    const ctrl = this.abortControllers.get(client.id);
    if (!ctrl) return; // client disconnected before handler ran

    // WR-02: Validate payload before any async work
    const text = (payload?.message ?? '').trim();
    if (!text || text.length > 4000) {
      client.emit('chat:error', { message: 'Invalid message: must be 1–4000 characters' } satisfies ChatErrorPayload);
      return;
    }

    // Lazy conversation creation
    let conversationId = this.conversationIds.get(client.id);
    if (!conversationId) {
      const conv = await this.memoryService.createConversation(userId);
      conversationId = conv.id;
      this.conversationIds.set(client.id, conversationId);
    }

    let fullResponse = '';
    try {
      // WR-01: Fetch history and retrieval context BEFORE persisting user message
      // to avoid the current turn appearing twice in the LLM prompt.
      const [memoryContext, history] = await Promise.all([
        this.retrievalService.retrieve(text, userId),
        this.memoryService.getRecentMessages(conversationId, HISTORY_LIMIT),
      ]);

      // Persist user message after history fetch (D-01: last 10 messages)
      await this.memoryService.addMessage(conversationId, userId, 'user', text);

      const messages = buildMessages(memoryContext, history, text);

      for await (const token of this.llmService.streamResponse(messages, ctrl.signal)) {
        client.emit('chat:chunk', { token } satisfies ChatChunkPayload);
        fullResponse += token;
      }

      // WR-03: Only persist assistant response if the stream yielded tokens
      if (fullResponse.length > 0) {
        await this.memoryService.addMessage(conversationId, userId, 'assistant', fullResponse);
      }

      client.emit('chat:complete', { conversationId } satisfies ChatCompletePayload);

      // Fire-and-forget extraction — NEVER await (CHAT-06)
      void this.extractionService
        .enqueue(
          text + '\n' + fullResponse,
          userId,
          'conversation',
        )
        .catch((err: unknown) =>
          this.logger.error('Extraction enqueue failed', String(err)),
        );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Normal disconnect — client is gone, no error event needed
        this.logger.debug(`Stream aborted for client ${client.id}`);
        return;
      }
      this.logger.error('Stream error', String(err));
      client.emit('chat:error', { message: 'Stream failed' } satisfies ChatErrorPayload);
    }
  }
}

// --- Module-scope helper functions ---

function buildSystemPrompt(ctx: MemoryContext): string {
  const relevantMemories = ctx.memories.filter(
    (m: MemorySearchResult) => m.similarity >= MEMORY_THRESHOLD,
  );

  const memoryBlock =
    relevantMemories.length > 0
      ? relevantMemories
          .map(
            (m: MemorySearchResult) =>
              `[Memory: ${m.content} | confidence: ${m.confidence.toFixed(2)} | last confirmed: ${m.last_reinforced_at.toISOString().split('T')[0]}]`,
          )
          .join('\n')
      : '';

  const peopleBlock =
    ctx.people.length > 0
      ? ctx.people
          .map(
            (p: PersonRow) =>
              `[Person: ${p.name} | facts: ${JSON.stringify(p.facts)}]`,
          )
          .join('\n')
      : '';

  const contextSection = [memoryBlock, peopleBlock].filter(Boolean).join('\n');

  return contextSection
    ? `You are a helpful assistant with memory of this user.\n\n${contextSection}`
    : 'You are a helpful assistant.';
}

function buildMessages(
  ctx: MemoryContext,
  history: ConversationMessageRow[],
  currentMessage: string,
): BaseMessage[] {
  const system = new SystemMessage(buildSystemPrompt(ctx));
  const historyMessages: BaseMessage[] = history.map((row: ConversationMessageRow) =>
    row.role === 'user'
      ? new HumanMessage(row.content)
      : new AIMessage(row.content),
  );
  return [system, ...historyMessages, new HumanMessage(currentMessage)];
}
