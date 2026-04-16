---
plan: 03-03
phase: 03-chat-path
status: complete
started: 2026-04-16
completed: 2026-04-16
requirements:
  - CHAT-01
  - CHAT-06
  - CHAT-07
self_check: PASSED
---

## Summary

Built the scaffolding that ChatGateway (Plan 04) depends on: extended `MemoryService` with `getRecentMessages()`, created `ExtractionService` as a Phase 4 stub, defined WebSocket event payload types, and wired `ChatModule` to import all four dependency modules. All interfaces are finalized so the gateway can be written against known contracts.

## What Was Built

- **`src/memory/memory.service.ts`** — `getRecentMessages(conversationId, limit)` added: queries `conversation_messages` with `ORDER BY created_at DESC LIMIT $2` then `.reverse()` for chronological order
- **`src/memory/memory.service.spec.ts`** — 3 new tests: SQL correctness, DESC→chronological reversal, empty result handling (10 total, all passing)
- **`src/extraction/extraction.service.ts`** — `ExtractionService` stub with `enqueue(text, userId, sourceType)` no-op; logs `textLen` only (no PII); Phase 4 replaces with BullMQ
- **`src/extraction/extraction.module.ts`** — `ExtractionModule` providing and exporting `ExtractionService`
- **`src/chat/chat.types.ts`** — `ChatSendPayload`, `ChatChunkPayload`, `ChatCompletePayload`, `ChatErrorPayload` interfaces
- **`src/chat/chat.module.ts`** — `ChatModule` importing `RetrievalModule`, `LlmModule`, `ExtractionModule`, `MemoryModule`; no `ChatGateway` yet (Plan 04)

## TDD Gates

Task 1 used TDD:
- **RED** — tests written first verifying SQL shape, reversal, and empty result behavior
- **GREEN** — `getRecentMessages` implemented to satisfy all 3 tests

Task 2 was infrastructure (no logic to test at stub level; full-suite green confirms wiring).

## Test Results

43/43 tests pass across 7 test files. No `any` types. No `console.log`. No regressions.

## Key Files

### Modified
- `src/memory/memory.service.ts` — `getRecentMessages()` method added
- `src/memory/memory.service.spec.ts` — 3 new test cases appended

### Created
- `src/extraction/extraction.service.ts` — Phase 4 stub with correct interface
- `src/extraction/extraction.module.ts` — Module exporting ExtractionService
- `src/chat/chat.types.ts` — WebSocket event payload type definitions
- `src/chat/chat.module.ts` — ChatModule with all 4 dependency imports

## Deviations

None. All files match the exact specifications in the plan.

## Requirements Satisfied

- **CHAT-01** — `MemoryService.getRecentMessages()` returns chronological `ConversationMessageRow[]`
- **CHAT-06** — `ExtractionService.enqueue()` stub created with exact Phase 4 interface
- **CHAT-07** — `ChatModule` scaffold wires `RetrievalModule`, `LlmModule`, `ExtractionModule`, `MemoryModule`
