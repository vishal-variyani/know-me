---
plan: 03-02
phase: 03-chat-path
status: complete
started: 2026-04-16
completed: 2026-04-16
requirements:
  - CHAT-04
  - CHAT-05
self_check: PASSED
---

## Summary

Implemented the LlmModule — a LangChain ChatAnthropic streaming wrapper that provides an `AsyncIterable<string>` token stream for ChatGateway consumption. Installed `@langchain/anthropic` as a production dependency and built `LlmService` with `streamResponse()` that handles both `string` and `MessageContentComplex[]` content types, propagates `AbortSignal` for cancellation on WebSocket disconnect, and reads the model name from `ANTHROPIC_MODEL` env var via `ConfigService.getOrThrow`.

## What Was Built

- **`src/llm/llm.service.ts`** — `LlmService` with `streamResponse(messages, signal)` async generator; `OnModuleInit` initializes `ChatAnthropic` with model from env var; content type guard handles both string chunks and complex content arrays; empty tokens are filtered
- **`src/llm/llm.module.ts`** — `LlmModule` providing and exporting `LlmService`; no explicit `ConfigModule` import needed (isGlobal: true)
- **`src/llm/llm.service.spec.ts`** — 4 unit tests: string token yielding, complex content filtering, empty token skip, `onModuleInit` config read; all using mocked `ChatAnthropic` (no real API calls)
- **`package.json`** — `@langchain/anthropic` added to production dependencies

## TDD Gates

- **RED** — `test(03-02): add failing tests for LlmService streamResponse and onModuleInit` (commit 411fd66)
- **GREEN** — `feat(03-02): implement LlmService with ChatAnthropic streaming and AbortSignal wiring` (commit a73c6c7)

## Test Results

36/36 tests pass across 6 test files. No `any` types. No `console.log`. No regressions introduced.

## Key Files

### Created
- `src/llm/llm.service.ts` — `LlmService` with `streamResponse()` async generator
- `src/llm/llm.module.ts` — `LlmModule` exporting `LlmService`
- `src/llm/llm.service.spec.ts` — 4 unit tests, all passing

### Modified
- `package.json` / `pnpm-lock.yaml` — `@langchain/anthropic@1.3.26` added to dependencies

## Deviations

None. Implementation follows the `EmbeddingService` pattern exactly as specified.

## Requirements Satisfied

- **CHAT-04** — `LlmService.streamResponse()` returns `AsyncIterable<string>` with `AbortSignal` wiring
- **CHAT-05** — `LlmService` uses `ChatAnthropic` with model from `ANTHROPIC_MODEL` env var; `@langchain/anthropic` installed
