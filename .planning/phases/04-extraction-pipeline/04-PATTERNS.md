# Phase 4: Extraction Pipeline - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 10 (7 modified, 3 new)
**Analogs found:** 8 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/extraction/extraction.service.ts` | service | event-driven (LangGraph StateGraph) | `src/embedding/embedding.service.ts` | role-match (OnModuleInit init pattern) |
| `src/extraction/extraction.module.ts` | module/config | — | `src/chat/chat.module.ts` | role-match (multi-import module) |
| `src/extraction/extraction.processor.ts` | processor/worker | event-driven (queue consumer) | `src/chat/chat.gateway.ts` | partial (event handler lifecycle) |
| `src/extraction/nodes/classify.node.ts` | utility/transform | transform | `src/retrieval/retrieval.service.ts` | partial (pure function, no DB) |
| `src/extraction/nodes/extract.node.ts` | service/transform | request-response (LLM call) | `src/llm/llm.service.ts` | role-match (LangChain call + ConfigService) |
| `src/extraction/nodes/validate.node.ts` | utility/transform | transform | `src/retrieval/retrieval.service.ts` | partial (pure deterministic logic) |
| `src/extraction/nodes/store.node.ts` | service | CRUD | `src/memory/memory.service.ts` | exact (DB writes + inject pool pattern) |
| `src/memory/memory.types.ts` | types | — | self (update `FactType`) | exact (type-only edit) |
| `src/app.module.ts` | config/module | — | self + `src/database/database.module.ts` | exact (forRoot factory pattern) |
| `supabase/migrations/20260416000000_fact_type_constraint.sql` | migration | — | `supabase/migrations/20260415000005_memory_entries.sql` | exact (ALTER TABLE CHECK constraint) |

---

## Pattern Assignments

### `src/extraction/extraction.service.ts` (service, event-driven)

**Analog:** `src/embedding/embedding.service.ts`

**Imports pattern** (embedding.service.ts lines 1-4):
```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
```

**Adapted imports for ExtractionService:**
```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { StateGraph, END } from '@langchain/langgraph';
import type { ExtractionState } from './extraction.types.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people.service.js';
// Node factories imported from ./nodes/
```

**OnModuleInit init pattern** (embedding.service.ts lines 14-29):
```typescript
onModuleInit(): void {
  const model = this.config.getOrThrow<string>('OPENAI_EXTRACTION_MODEL');
  this.llm = new ChatOpenAI({ model, temperature: 0 });
  // Build LangGraph StateGraph here — compiled graph stored as private property
  this.graph = buildGraph(this.llm, this.embeddingService, this.memoryService, this.peopleService);
  this.logger.log(`ExtractionService initialized with model=${model}`);
}
```

**Public surface — enqueue()** (extraction.service.ts lines 7-16, stub to replace):
```typescript
// PRESERVE this exact signature — ChatGateway calls this without change
async enqueue(
  text: string,
  userId: string,
  sourceType: 'conversation' | 'document',
): Promise<void> {
  await this.queue.add('extract', { content: text, userId, sourceType });
}
```

**Logger pattern** (embedding.service.ts line 9):
```typescript
private readonly logger = new Logger(ExtractionService.name);
```

---

### `src/extraction/extraction.module.ts` (module, config)

**Analog:** `src/chat/chat.module.ts`

**Multi-import module pattern** (chat.module.ts lines 1-12):
```typescript
import { Module } from '@nestjs/common';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { ChatGateway } from './chat.gateway.js';

@Module({
  imports: [RetrievalModule, LlmModule, ExtractionModule, MemoryModule],
  providers: [ChatGateway],
})
export class ChatModule {}
```

**Adapted pattern for ExtractionModule:**
```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ExtractionService } from './extraction.service.js';
import { ExtractionProcessor } from './extraction.processor.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'extraction' }),
    EmbeddingModule,
    MemoryModule,
  ],
  providers: [ExtractionService, ExtractionProcessor],
  exports: [ExtractionService],
})
export class ExtractionModule {}
```

Note: `MemoryModule` already exports both `MemoryService` and `PeopleService` (memory.module.ts lines 5-8).

---

### `src/extraction/extraction.processor.ts` (processor, event-driven)

**Analog:** `src/chat/chat.gateway.ts` (closest event-handler lifecycle pattern in the codebase)

No `WorkerHost` exists in the codebase — this is the first BullMQ processor. Pattern comes from `@nestjs/bullmq` docs + NestJS conventions observed throughout the project.

**Imports pattern** (modeled on chat.gateway.ts lines 1-19 structure):
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ExtractionService } from './extraction.service.js';
import type { ExtractionJobPayload } from './extraction.types.js';
```

**WorkerHost class pattern** (no existing analog — standard @nestjs/bullmq pattern):
```typescript
@Processor('extraction', { concurrency: 3 })
export class ExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(private readonly extractionService: ExtractionService) {
    super();
  }

  async process(job: Job<ExtractionJobPayload>): Promise<void> {
    // D-26: BullMQ job ID as correlation ID for all log calls within this job
    const correlationId = job.id ?? 'unknown';
    this.logger.debug(`[${correlationId}] Processing job attempt=${job.attemptsMade}`);
    await this.extractionService.runGraph(job.data, correlationId);
    this.logger.debug(`[${correlationId}] Job complete`);
  }
}
```

**Retry config** (applied at queue registration or job add — not in the processor class itself):
```typescript
// In ExtractionService.enqueue():
await this.queue.add('extract', payload, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});
```

---

### `src/extraction/nodes/classify.node.ts` (utility, transform)

**Analog:** `src/retrieval/retrieval.service.ts` — pure synchronous function consuming injected deps via closure

**Pure function / closure pattern** (retrieval.service.ts lines 17-34):
```typescript
async retrieve(text: string, userId: string): Promise<MemoryContext> {
  const [memories, people] = await Promise.all([
    this.embeddingService.embed(text).then(...),
    this.peopleService.lookupByNames(...),
  ]);
  this.logger.debug(`retrieve userId=${userId} ...`);
  return { memories, people };
}
```

**Node function shape** (LangGraph node convention — no existing analog, new pattern):
```typescript
// Node functions are plain functions closed over a Logger; they take and return ExtractionState.
// D-01: Rule-based only — no LLM, no async needed.
export function makeClassifyNode(logger: Logger) {
  return function classifyNode(state: ExtractionState): Partial<ExtractionState> {
    const { content } = state;
    const hasProperNouns = /\b[A-Z][a-z]+\b/.test(content);
    const isTrivial = /^(ok|thanks|sure|yes|no|hi|hello|bye)\.?$/i.test(content.trim());
    const shouldExtract = hasProperNouns && !isTrivial;
    logger.debug(`classifyNode shouldExtract=${shouldExtract} contentLen=${content.length}`);
    return { classifyResult: { shouldExtract } };
  };
}
```

**Conditional edge pattern** (D-22 — LangGraph routing):
```typescript
// In ExtractionService buildGraph():
graph.addConditionalEdges('classify', (state) =>
  state.classifyResult?.shouldExtract ? 'extract' : END,
);
```

---

### `src/extraction/nodes/extract.node.ts` (service/transform, request-response)

**Analog:** `src/llm/llm.service.ts` — LangChain model call, ConfigService, Logger, OnModuleInit init

**LangChain model instantiation pattern** (llm.service.ts lines 13-16):
```typescript
onModuleInit(): void {
  const model = this.config.getOrThrow<string>('ANTHROPIC_MODEL');
  this.llm = new ChatAnthropic({ model, streaming: true });
```

**Adapted for Extract node** (D-04, D-05, D-06):
```typescript
// makeExtractNode receives the pre-constructed llm from ExtractionService (D-27)
export function makeExtractNode(llm: ChatOpenAI, logger: Logger) {
  return async function extractNode(state: ExtractionState): Promise<Partial<ExtractionState>> {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', EXTRACT_SYSTEM_PROMPT],
      ['human', '{content}'],
    ]);
    const chain = prompt.pipe(llm.withStructuredOutput(ExtractOutputSchema));
    let result: ExtractOutput;
    try {
      result = await chain.invoke({ content: state.content });
    } catch (err: unknown) {
      // D-06: Retry once; on second failure log and return empty
      try {
        result = await chain.invoke({ content: state.content });
      } catch (retryErr: unknown) {
        logger.error(`extractNode failed after retry: ${String(retryErr)}`);
        return { extractResult: { people: [], topics: [], emotionalTone: 'neutral', keyFacts: [] } };
      }
    }
    logger.debug(`extractNode people=${result.people.length} keyFacts=${result.keyFacts.length}`);
    return { extractResult: result };
  };
}
```

**Error handling pattern** (following chat.gateway.ts lines 143-150 structure):
```typescript
// err typed as unknown, narrowed before use
} catch (err: unknown) {
  logger.error(`extractNode error: ${String(err)}`);
}
```

---

### `src/extraction/nodes/validate.node.ts` (utility, transform)

**Analog:** `src/retrieval/retrieval.service.ts` — deterministic data processing, Logger.debug

**Deterministic processing pattern** (retrieval.service.ts lines 28-31):
```typescript
this.logger.debug(
  `retrieve userId=${userId} memories=${memories.length} people=${people.length}`,
);
return { memories, people };
```

**Validate node shape** (D-07 through D-14):
```typescript
export function makeValidateNode(logger: Logger) {
  return function validateNode(state: ExtractionState): Partial<ExtractionState> {
    if (!state.extractResult) return { validateResult: undefined };

    const { people, keyFacts } = state.extractResult;

    // D-09: Name normalization — trim, title-case, strip honorifics
    // D-10: Filter pronoun / generic reference names
    // D-11: Within-batch deduplication by normalized name
    // D-12: Relationship synonym mapping
    const normalized = normalizePeople(people);

    const valid = normalized.length > 0 || keyFacts.length > 0;
    logger.debug(`validateNode valid=${valid} people=${normalized.length} keyFacts=${keyFacts.length}`);

    if (!valid) return { validateResult: undefined }; // D-13: conditional edge → END

    return { validateResult: { people: normalized, keyFacts } };
  };
}
```

**Conditional edge pattern** (D-23):
```typescript
graph.addConditionalEdges('validate', (state) =>
  state.validateResult ? 'store' : END,
);
```

---

### `src/extraction/nodes/store.node.ts` (service, CRUD)

**Analog:** `src/memory/memory.service.ts` — exact match (DB writes, PG_POOL injection pattern, Logger.debug per operation)

**DB write pattern** (memory.service.ts lines 75-109):
```typescript
async upsertMemoryEntry(
  content: string,
  vector: number[],
  userId: string,
  factType: FactType,
  sourceType: 'conversation' | 'document',
): Promise<void> {
  const similar = await this.searchSimilar(userId, vector, 1);
  if (similar.length > 0 && similar[0].similarity >= 0.9) {
    await this.pool.query(
      `UPDATE memory_entries SET last_reinforced_at = NOW(), confidence = LEAST(confidence + 0.05, 1.0), updated_at = NOW() WHERE id = $1`,
      [similar[0].id],
    );
    this.logger.debug(`Reinforced memory entry ${similar[0].id}`);
  } else {
    await this.pool.query(
      `INSERT INTO memory_entries (user_id, content, embedding, fact_type, source_type) VALUES ($1, $2, $3, $4, $5)`,
      [userId, content, pgvector.toSql(vector), factType, sourceType],
    );
    this.logger.debug(`Inserted new memory entry for user=${userId} factType=${factType}`);
  }
}
```

**People upsert pattern** (people.service.ts lines 32-50):
```typescript
async upsertPerson(
  name: string,
  userId: string,
  facts: Record<string, unknown> = {},
): Promise<PersonRow> {
  const result = await this.pool.query<PersonRow>(
    `INSERT INTO people (user_id, name, facts)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, name)
     DO UPDATE SET
       facts = people.facts || EXCLUDED.facts,
       updated_at = NOW()
     RETURNING id, user_id, name, aliases, facts, created_at, updated_at`,
    [userId, name, JSON.stringify(facts)],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`[PeopleService] upsertPerson returned no row for name=${name}`);
  return row;
}
```

**Store node shape** (D-15 through D-20 — receives injected services via closure per D-27):
```typescript
export function makeStoreNode(
  memoryService: MemoryService,
  peopleService: PeopleService,
  embeddingService: EmbeddingService,
  logger: Logger,
) {
  return async function storeNode(state: ExtractionState): Promise<Partial<ExtractionState>> {
    if (!state.validateResult) return { storeResult: { persisted: 0 } };
    const { people, keyFacts } = state.validateResult;
    let persisted = 0;

    // D-15, D-16: People upsert via existing PeopleService.upsertPerson()
    for (const person of people) {
      const factsRecord: Record<string, unknown> = {
        relationship: person.relationship,
        facts: person.facts,
      };
      await peopleService.upsertPerson(person.name, state.userId, factsRecord);
      persisted++;
    }

    // D-19, D-20: Memory entries via EmbeddingService.embed() + MemoryService.upsertMemoryEntry()
    for (const fact of keyFacts) {
      const vector = await embeddingService.embed(fact);
      await memoryService.upsertMemoryEntry(fact, vector, state.userId, 'fact', state.sourceType);
      persisted++;
    }

    logger.debug(`storeNode persisted=${persisted} userId=${state.userId}`);
    return { storeResult: { persisted } };
  };
}
```

---

### `src/memory/memory.types.ts` (types, type-only edit)

**Analog:** Self — minimal edit to line 1 only.

**Current line 1:**
```typescript
export type FactType = 'preference' | 'relationship' | 'event' | 'belief' | 'goal' | 'habit';
```

**Replace with** (D-18):
```typescript
export type FactType = 'fact' | 'preference' | 'relationship' | 'emotion';
```

No other lines change. `MemoryService.upsertMemoryEntry()` already accepts `FactType` and uses it as a SQL parameter — the type update flows through automatically.

---

### `src/app.module.ts` (config/module)

**Analog:** `src/database/database.module.ts` — `useFactory` provider pattern with `ConfigService` injection

**useFactory pattern** (database.module.ts lines 9-29):
```typescript
{
  provide: PG_POOL,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
    });
  },
}
```

**BullModule.forRoot adapted for app.module.ts:**
```typescript
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ExtractionModule } from './extraction/extraction.module.js';

// Add to @Module imports array:
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    connection: {
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: parseInt(config.getOrThrow<string>('REDIS_PORT'), 10),
    },
  }),
}),
ExtractionModule,
```

Note: `REDIS_HOST` and `REDIS_PORT` are already in `validateEnv()` in `src/main.ts` (lines 8-9) — no main.ts changes needed.

---

### `supabase/migrations/20260416000000_fact_type_constraint.sql` (migration)

**Analog:** `supabase/migrations/20260415000005_memory_entries.sql` — CHECK constraint syntax; `supabase/migrations/20260415000007_people_unique_name.sql` — ALTER TABLE pattern

**ALTER TABLE pattern** (20260415000007_people_unique_name.sql line 3):
```sql
ALTER TABLE people ADD CONSTRAINT people_user_id_name_unique UNIQUE (user_id, name);
```

**CHECK constraint from original table** (20260415000005_memory_entries.sql line 6):
```sql
fact_type text NOT NULL CHECK (fact_type IN ('preference','relationship','event','belief','goal','habit')),
```

**Migration to write** (D-18 — update CHECK constraint):
```sql
-- Phase 4: Update fact_type CHECK constraint to new enum values.
-- Old: preference | relationship | event | belief | goal | habit
-- New: fact | preference | relationship | emotion
ALTER TABLE memory_entries
  DROP CONSTRAINT IF EXISTS memory_entries_fact_type_check;

ALTER TABLE memory_entries
  ADD CONSTRAINT memory_entries_fact_type_check
    CHECK (fact_type IN ('fact', 'preference', 'relationship', 'emotion'));
```

Note: Existing rows with old fact_type values must be back-filled or the constraint will reject them. The migration must either update existing rows first, or use a two-step deploy (add new constraint as NOT VALID, then VALIDATE separately). The planner should account for this.

---

## New File: `src/extraction/extraction.types.ts`

This file is implied by all node files and the processor — it must be created to hold the typed interfaces.

**Role:** types  
**Data Flow:** —  
**Analog:** `src/memory/memory.types.ts` — interface-only file, no class decorators

**Pattern** (memory.types.ts lines 1-37):
```typescript
// Interface-only file — no imports needed unless referencing other types

export interface ExtractionState {
  content: string;
  userId: string;
  sourceType: 'conversation' | 'document';
  classifyResult?: { shouldExtract: boolean };
  extractResult?: {
    people: PersonExtraction[];
    topics: string[];
    emotionalTone: string;
    keyFacts: string[];
  };
  validateResult?: { people: PersonExtraction[]; keyFacts: string[] };
  storeResult?: { persisted: number };
}

export interface PersonExtraction {
  name: string;
  relationship: string;
  facts: string[];
}

export interface ExtractionJobPayload {
  content: string;
  userId: string;
  sourceType: 'conversation' | 'document';
}
```

---

## Shared Patterns

### NestJS Logger
**Source:** Every service in the codebase (e.g., `src/embedding/embedding.service.ts` line 9, `src/memory/memory.service.ts` line 14)
**Apply to:** `ExtractionService`, `ExtractionProcessor`, all node factory functions (passed as parameter)
```typescript
private readonly logger = new Logger(ClassName.name);
```
Node functions receive `logger: Logger` as a parameter from their factory — they do not instantiate their own logger.

### ConfigService env var access
**Source:** `src/embedding/embedding.service.ts` line 15, `src/llm/llm.service.ts` line 14
**Apply to:** `ExtractionService.onModuleInit()` for `OPENAI_EXTRACTION_MODEL`
```typescript
const model = this.config.getOrThrow<string>('OPENAI_EXTRACTION_MODEL');
```

### Error narrowing (unknown catch)
**Source:** `src/chat/chat.gateway.ts` lines 143-150
**Apply to:** `ExtractionProcessor.process()`, `extract.node.ts`
```typescript
} catch (err: unknown) {
  if (err instanceof Error && err.name === 'AbortError') { ... }
  this.logger.error('description', String(err));
}
```

### Module export pattern
**Source:** `src/memory/memory.module.ts` lines 5-8, `src/embedding/embedding.module.ts`
**Apply to:** `ExtractionModule`
```typescript
// Every module providing injectable services exports them explicitly
exports: [ExtractionService],
```

### Row null-guard pattern
**Source:** `src/memory/people.service.ts` lines 46-48, `src/memory/memory.service.ts` line 29
**Apply to:** `store.node.ts` any direct pool.query calls (none expected — delegates to services)
```typescript
const row = result.rows[0];
if (!row) throw new Error(`[ServiceName] methodName returned no row for ...`);
return row;
```

### .js extension on all local imports
**Source:** Every file in the codebase (e.g., `src/extraction/extraction.module.ts` line 2)
**Apply to:** All new files
```typescript
import { ExtractionService } from './extraction.service.js';
// NOT './extraction.service' — ESM requires explicit .js extension
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/extraction/extraction.processor.ts` | processor | event-driven (BullMQ WorkerHost) | No BullMQ processors exist in the codebase; first queue worker |
| `src/extraction/nodes/classify.node.ts` | utility | transform (rule-based filter) | No LangGraph node functions exist; new pattern for this project |

For these two files, use `@nestjs/bullmq` `WorkerHost` docs pattern and LangGraph node function convention. The node factory pattern (closure over injected services + Logger) is the planner's design decision per D-27.

---

## New Dependencies Required

These packages are **not** in `package.json` and must be installed before any implementation plan can succeed:

| Package | Purpose | Install as |
|---|---|---|
| `@nestjs/bullmq` | NestJS BullMQ integration (BullModule, WorkerHost, Processor decorator) | dependency |
| `bullmq` | BullMQ queue and worker types | dependency |
| `ioredis` | Redis client (peer dep of bullmq) | dependency |
| `@langchain/langgraph` | StateGraph, END, conditional edges | dependency |
| `class-validator` | D-08: schema validation in Validate node | dependency |
| `class-transformer` | Peer dep of class-validator | dependency |

The planner must include a package installation step (plan 04-01 or a prerequisite) before any code that imports these packages.

---

## Metadata

**Analog search scope:** `src/` (all modules), `supabase/migrations/`
**Files scanned:** 15 source files, 8 migration files
**Pattern extraction date:** 2026-04-16
