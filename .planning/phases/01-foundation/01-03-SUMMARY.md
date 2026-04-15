---
phase: 01-foundation
plan: 03
subsystem: database
tags: [supabase, postgres, pgvector, hnsw, rls, migrations, sql]

requires: []
provides:
  - 7 Supabase migration files covering full Phase 1 schema
  - conversations, conversation_messages, message_embeddings, people, memory_entries tables
  - RLS policies on all 5 tables (user_id = auth.uid())
  - B-tree user_id indexes on all 5 tables
  - HNSW indexes (m=16, ef_construction=64) on message_embeddings and memory_entries
  - search_user_memories function with SECURITY INVOKER + SET LOCAL hnsw params

affects: [02-core-data-layer, 03-chat-path, 04-extraction-pipeline, 05-document-upload]

tech-stack:
  added: []
  patterns:
    - RLS pattern: ENABLE ROW LEVEL SECURITY + policy TO authenticated USING (user_id = auth.uid())
    - HNSW pattern: USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
    - Search function pattern: SECURITY INVOKER + SET LOCAL hnsw params + explicit user_id WHERE

key-files:
  created:
    - supabase/migrations/20260415000000_enable_extensions.sql
    - supabase/migrations/20260415000001_conversations.sql
    - supabase/migrations/20260415000002_conversation_messages.sql
    - supabase/migrations/20260415000003_message_embeddings.sql
    - supabase/migrations/20260415000004_people.sql
    - supabase/migrations/20260415000005_memory_entries.sql
    - supabase/migrations/20260415000006_search_functions.sql
  modified: []

key-decisions:
  - "SECURITY INVOKER on search_user_memories — prevents privilege escalation (T-01-03-02)"
  - "SET LOCAL hnsw.ef_search + iterative_scan — transaction-scoped, prevents connection pool contamination (T-01-03-04)"
  - "Explicit WHERE me.user_id = p_user_id in function body — enforces isolation before vector ranking, not relying solely on RLS"
  - "supersedes uuid self-reference on memory_entries — enables memory chain/update tracking"

patterns-established:
  - "RLS pattern: every user-owned table gets ENABLE ROW LEVEL SECURITY + FOR ALL policy with user_id = auth.uid()"
  - "HNSW pattern: m=16, ef_construction=64 on all vector columns (1536-dim OpenAI embeddings)"
  - "Search function pattern: SECURITY INVOKER + SET LOCAL params + explicit user_id WHERE clause"

requirements-completed: [DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07]

duration: 12min
completed: 2026-04-15
---

# Plan 01-03: Supabase Migrations Summary

**Full Phase 1 database schema: 5 tables with RLS + HNSW vector indexes + search_user_memories function deployed to local Postgres**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-15T16:45:00Z
- **Completed:** 2026-04-15T16:57:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- All 7 migration files written with exact DDL from requirements (DB-01 through DB-07)
- 5 tables created with RLS enabled and user_id B-tree indexes
- 2 HNSW indexes on vector(1536) columns (m=16, ef_construction=64)
- `search_user_memories` function with SECURITY INVOKER + SET LOCAL hnsw params + explicit user_id isolation
- Migrations pushed to local Postgres — all 5 tables, indexes, and function verified (human checkpoint approved)

## Task Commits

1. **Task 1: Write all seven migration SQL files** - `ce864ba` (feat)
2. **Task 2: Push migrations** — verified via human checkpoint (approved)

## Files Created/Modified
- `supabase/migrations/20260415000000_enable_extensions.sql` — pgvector + uuid-ossp extensions
- `supabase/migrations/20260415000001_conversations.sql` — conversations table + RLS + B-tree
- `supabase/migrations/20260415000002_conversation_messages.sql` — messages table + RLS + B-tree
- `supabase/migrations/20260415000003_message_embeddings.sql` — embeddings table + RLS + HNSW + B-tree
- `supabase/migrations/20260415000004_people.sql` — people table + RLS + B-tree
- `supabase/migrations/20260415000005_memory_entries.sql` — memory table + RLS + HNSW + B-tree + supersedes FK
- `supabase/migrations/20260415000006_search_functions.sql` — search_user_memories with SECURITY INVOKER

## Decisions Made
- `SECURITY INVOKER` not `SECURITY DEFINER` on search function — prevents privilege escalation and cross-user data leakage (T-01-03-02)
- `SET LOCAL` (not `SET`) for hnsw parameters — transaction-scoped, safe for pgBouncer connection pooling (T-01-03-04)
- Explicit `WHERE me.user_id = p_user_id` inside function body — enforces user isolation at the SQL level before vector ranking, defence in depth beyond RLS

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
- Supabase CLI not installed locally — migrations applied via direct psql (Option B from plan). Files committed and schema verified via human checkpoint.

## User Setup Required
To apply migrations to a fresh environment:
```bash
docker compose up -d
for f in supabase/migrations/*.sql; do
  psql "postgresql://postgres:postgres@localhost:5432/postgres" -f "$f"
done
```

## Next Phase Readiness
- Full schema is live in local Postgres
- All 5 tables available for Phase 2 repository layer (TypeORM/Drizzle entities)
- HNSW indexes ready for vector similarity queries in Phase 3+
- No blockers

---
*Phase: 01-foundation*
*Completed: 2026-04-15*
