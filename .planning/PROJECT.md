# Know Me

## What This Is

Know Me is a multi-user conversational memory agent backend built on NestJS 11. Users chat via WebSocket, and the system continuously extracts and stores facts about them and the people in their lives. Every subsequent response is personalized via hybrid memory retrieval — semantic search over stored memories plus direct lookups for named people.

## Core Value

The AI gets meaningfully better at knowing each user the more they interact — persistent, accumulating memory that makes every response feel personally aware.

## Requirements

### Validated

- ✓ NestJS 11 app scaffolded and boots — existing

### Active

- [ ] WebSocket gateway (Socket.io) with `chat:send`, `chat:chunk`, `chat:complete` events; `userId` in handshake for session scoping
- [ ] Streaming chat via LangChain + Claude `claude-sonnet-4-20250514` with hybrid memory injected into context
- [ ] Hybrid retrieval: pgvector cosine similarity top-k=5 (memory_entries) + direct people table lookup when names are mentioned
- [ ] Background LangGraph extraction pipeline: Classify → Extract → Validate → Store (runs after each message)
- [ ] Five PostgreSQL tables with RLS scoped to `user_id`: `conversations`, `conversation_messages`, `message_embeddings` (pgvector HNSW), `people`, `memory_entries`
- [ ] REST endpoint for journal/document upload that feeds the extraction pipeline
- [ ] LangChain embeddings via `text-embedding-3-small` (1536 dims) for all vector operations
- [ ] GPT-4o-mini via LangChain for the extraction pipeline
- [ ] Vitest test suite with unit coverage of core services
- [ ] Docker-based Supabase + pgvector local dev environment

### Out of Scope

- Frontend UI — backend API only; a client may be built later but is not in scope
- JWT authentication — `userId` passed directly in WebSocket handshake; RLS handles data isolation
- Hardcoded model names — all LLM identifiers must come from env vars
- `console.log` — NestJS Logger is the only logging mechanism
- `any` types — TypeScript strict throughout; use `unknown` with narrowing

## Context

- A blank NestJS 11 scaffold exists (`app.module`, `app.controller`, `app.service`, `main.ts`); all domain dependencies (LangChain, LangGraph, Socket.io, Supabase client, pgvector) still need to be added
- Supabase PostgreSQL + pgvector runs via Docker for local dev; production target is Supabase cloud
- All LLM model identifiers are env-var driven — specific models: `claude-sonnet-4-20250514` (chat), `gpt-4o-mini` (extraction), `text-embedding-3-small` 1536 dims (embeddings)
- Extraction pipeline runs in the background (fire-and-forget from the WebSocket handler's perspective) — chat streaming must not block on it
- Document upload extracts memories the same way conversation messages do — same LangGraph pipeline
- `pnpm` is the package manager throughout

## Constraints

- **Tech stack**: NestJS 11, Node 22, TypeScript strict, pnpm — fixed, no alternatives
- **Auth model**: No JWT; `userId` in Socket.io handshake; RLS on all tables ensures per-user data isolation
- **Code quality**: No `any` types (use `unknown` + narrowing); NestJS Logger only (no `console.log`)
- **LLMs**: All model names via env vars; specific models locked: `claude-sonnet-4-20250514`, `gpt-4o-mini`, `text-embedding-3-small` (1536 dims)
- **Package manager**: pnpm — do not use npm or yarn
- **Testing**: Vitest (not Jest — the scaffold's jest config will be replaced)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| LangChain for all LLM/embedding calls | Unified abstraction over OpenAI + Anthropic SDKs; swap models without changing call sites | — Pending |
| LangGraph for extraction pipeline | Explicit node graph makes Classify → Extract → Validate → Store stages testable and replaceable independently | — Pending |
| Hybrid retrieval (pgvector RAG + people direct lookup) | Semantic search handles general memory; named-entity lookup guarantees precise person facts are never missed by cosine similarity | — Pending |
| userId in WebSocket handshake (no JWT) | Simplifies v1 auth; RLS is the security boundary; JWT can be layered later | — Pending |
| Extraction runs background (fire-and-forget) | Keeps chat streaming latency low; extraction latency is irrelevant to UX | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-16 — Phase 02 complete: DatabaseModule, EmbeddingModule, MemoryService, PeopleService all wired into AppModule*
