# Project State: Know Me

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** The AI gets meaningfully better at knowing each user the more they interact — persistent, accumulating memory that makes every response feel personally aware.
**Current focus:** Phase 1 — Foundation

## Milestone

**v1.0** — Working conversational memory agent backend

## Phase Progress

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Foundation | 0/4 | ○ Pending |
| 2 | Core Data Layer | 0/3 | ○ Pending |
| 3 | Chat Path | 0/4 | ○ Pending |
| 4 | Extraction Pipeline | 0/4 | ○ Pending |
| 5 | Document Upload | 0/2 | ○ Pending |
| 6 | Test Suite & Hardening | 0/3 | ○ Pending |

## Next Action

Run `/gsd-plan-phase 1` to plan Phase 1: Foundation.

## Key Context

- Stack: NestJS 11, Node 22, TypeScript strict, Socket.io, LangChain.js, LangGraph.js, pgvector (HNSW), BullMQ + Redis, Vitest, pnpm
- LLMs: `claude-sonnet-4-20250514` (chat), `gpt-4o-mini` (extraction), `text-embedding-3-small` 1536 dims — all via env vars
- Auth: userId in Socket.io handshake (no JWT); RLS + explicit user_id filter on all queries
- Two runtime paths: chat path (latency-critical, streaming) + extraction path (fire-and-forget, BullMQ)
- Critical Phase 1 task: remove Jest scaffold and configure Vitest with SWC decorator metadata

## Config

- Mode: interactive
- Granularity: standard
- Parallelization: true
- Commit docs: true
- Research before planning: yes
- Plan checker: yes
- Verifier: yes
- Model profile: balanced

---
*Last updated: 2026-04-15 after project initialization*
