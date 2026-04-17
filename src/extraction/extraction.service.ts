import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, END } from '@langchain/langgraph';
import type { Queue } from 'bullmq';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people/people.service.js';
import { makeExtractNode } from './nodes/extract.node.js';
import { makeValidateNode } from './nodes/validate.node.js';
import { makeStoreNode } from './nodes/store.node.js';
import type { ExtractionJobPayload, ExtractionState } from './extraction.types.js';

type CompiledExtractionGraph = {
  invoke(input: ExtractionState): Promise<unknown>;
};

type ExtractionGraphBuilder = {
  addNode(name: 'extract' | 'validate' | 'store', node: unknown): void;
  setEntryPoint(name: 'extract'): void;
  addConditionalEdges(
    source: 'validate',
    route: (state: ExtractionState) => 'store' | typeof END,
  ): void;
  addEdge(source: 'extract' | 'store', target: 'validate' | typeof END): void;
  compile(): CompiledExtractionGraph;
};

// LangGraph requires a channels definition describing how state fields are merged.
// Using last-write-wins reducer for all fields — simple and correct for a linear
// pipeline where each node owns its output field exclusively.
function makeStateChannels(): Record<
  string,
  { value: (x: unknown, y: unknown) => unknown; default: () => undefined }
> {
  const fields: (keyof ExtractionState)[] = [
    'content',
    'userId',
    'sourceType',
    'correlationId',
    'extractResult',
    'validateResult',
    'storeResult',
  ];
  return Object.fromEntries(
    fields.map((f) => [
      f,
      { value: (_x: unknown, y: unknown) => y, default: () => undefined },
    ]),
  );
}

@Injectable()
export class ExtractionService implements OnModuleInit {
  private readonly logger = new Logger(ExtractionService.name);
  // Compiled graph — built in onModuleInit() after all injected services are ready (D-27)
  private graph!: CompiledExtractionGraph;

  constructor(
    @InjectQueue('extraction') private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly embeddingService: EmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly peopleService: PeopleService,
  ) {}

  onModuleInit(): void {
    // D-27: Graph constructed exactly once here (onModuleInit rather than constructor —
    // injected services are not guaranteed fully initialized in constructors under NestJS DI).
    const model = this.config.getOrThrow<string>('OPENAI_EXTRACTION_MODEL');
    const llm = new ChatOpenAI({ model, temperature: 0 });

    // Build node functions via factories — each closed over its dependencies (D-27)
    const extractNode = makeExtractNode(llm, this.logger);
    const validateNode = makeValidateNode(this.logger);
    const storeNode = makeStoreNode(
      this.memoryService,
      this.peopleService,
      this.embeddingService,
      this.logger,
    );

    // Compile LangGraph StateGraph (D-22, D-23, D-24).
    // LangGraph TypeScript generics are strict about node name literals — they only know
    // '__start__' until nodes are added. Cast to a narrowed structural builder type for
    // graph wiring to avoid false-positive TS2345 errors; runtime behavior is unaffected.
    const builder = new StateGraph<ExtractionState>({
      channels: makeStateChannels() as never,
    }) as unknown as ExtractionGraphBuilder;

    builder.addNode('extract', extractNode);
    builder.addNode('validate', validateNode);
    builder.addNode('store', storeNode);

    builder.setEntryPoint('extract');

    // D-23: Extract → Validate always (Validate decides its own END)
    builder.addEdge('extract', 'validate');

    // D-23: Validate → Store (if validateResult exists) or END
    builder.addConditionalEdges(
      'validate',
      (state: ExtractionState) =>
        state.validateResult !== undefined ? 'store' : END,
    );

    builder.addEdge('store', END);

    this.graph = builder.compile();

    this.logger.log(`ExtractionService initialized with model=${model}`);
  }

  // D-28: Only public surface — ChatGateway and UploadController call only this
  async enqueue(
    text: string,
    userId: string,
    sourceType: 'conversation' | 'document',
  ): Promise<void> {
    const payload: ExtractionJobPayload = { content: text, userId, sourceType };
    // D-25: attempts: 3 with exponential backoff (1s, 2s, 4s) — T-04-04-02 DoS mitigation
    await this.queue.add('extract', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
    this.logger.debug(
      `Enqueued extraction job userId=${userId} sourceType=${sourceType} contentLen=${text.length}`,
    );
  }

  // Called by ExtractionProcessor — not part of the public API surface
  async runGraph(
    payload: ExtractionJobPayload,
    correlationId: string,
  ): Promise<void> {
    const initialState: ExtractionState = {
      content: payload.content,
      userId: payload.userId,
      sourceType: payload.sourceType,
      correlationId,
    };

    this.logger.debug(
      `[${correlationId}] runGraph starting userId=${payload.userId} sourceType=${payload.sourceType} contentLen=${payload.content.length}`,
    );

    try {
      // EXTR-08: Error boundary — re-throw after logging to trigger BullMQ retry
      await this.graph.invoke(initialState);
      this.logger.debug(`[${correlationId}] runGraph complete`);
    } catch (err: unknown) {
      this.logger.error(
        `[${correlationId}] runGraph failed: ${String(err)}`,
      );
      // Re-throw so BullMQ treats this job as failed and applies retry/backoff (EXTR-08)
      throw err;
    }
  }
}
