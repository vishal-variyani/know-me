# Phase 1: Foundation - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Get the development environment fully operational:
- Remove Jest scaffold and replace with Vitest 2.x + unplugin-swc
- Write `docker-compose.yml` for local Postgres + pgvector + Redis
- Write Supabase CLI migrations for all five tables with RLS, HNSW indexes, B-tree indexes
- Wire `@nestjs/config` globally, env-var validation before `NestFactory.create()`, and `IoAdapter` in `main.ts`

This phase delivers infrastructure only. No domain services, no business logic.

</domain>

<decisions>
## Implementation Decisions

### Docker Compose
- **D-01:** Use `supabase/postgres` as the Postgres image — matches Supabase cloud environment exactly; pgvector is pre-bundled; migrations via `supabase db push` will behave identically locally and in production
- **D-02:** Lean setup — postgres + redis only; no Supabase Studio, no GoTrue, no Realtime services; DB managed via psql or any Postgres client

### Claude's Discretion
- Vitest smoke test structure (whether to convert existing `app.controller.spec.ts` or create a new dedicated DI smoke test; what assertions prove NestJS DI resolves with SWC)
- Exact Postgres port mapping and Redis version pin in docker-compose.yml
- Volume names and healthcheck configuration for docker-compose.yml
- Env validation implementation — plain if-checks vs declarative schema; format of startup error message
- TypeScript strict scope — INFRA-03 requires `noImplicitAny: true`; any additional strict flags should be added only if the existing scaffold compiles cleanly under them
- Migration file naming convention and directory structure under `supabase/migrations/`
- RLS helper function style (using `auth.uid()` vs explicit `user_id` parameter in policies)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Infrastructure & Tooling (INFRA-01 through INFRA-07) — exact Vitest/SWC config, env vars list, IoAdapter requirement, ConfigModule setup
- `.planning/REQUIREMENTS.md` §Database Schema (DB-01 through DB-07) — exact table columns, HNSW params (`m=16, ef_construction=64`), B-tree index requirement, `search_user_memories` function spec (`iterative_scan = relaxed_order`, `ef_search = 40`)

### Roadmap
- `.planning/ROADMAP.md` Phase 1 — Success Criteria and Plan descriptions (4 plans: Vitest, Docker, Migrations, Config)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app.module.ts` — existing AppModule; NestJS 11 module structure to extend with ConfigModule
- `src/main.ts` — current bootstrap function (plain `NestFactory.create` + `app.listen`); env validation and IoAdapter wiring go here
- `src/app.controller.spec.ts` — existing Jest smoke test; candidate for conversion to Vitest

### Established Patterns
- `package.json` uses `pnpm` as package manager — all installs must use `pnpm add`
- `tsconfig.json` already has `emitDecoratorMetadata: true` and `experimentalDecorators: true` — Vitest SWC config must preserve this for NestJS DI
- `tsconfig.json` has `noImplicitAny: false` — INFRA-03 requires flipping to `true`; existing scaffold code (app.controller, app.service) is minimal and should compile cleanly

### Integration Points
- `main.ts` is the sole bootstrap entry point — env validation must run as synchronous guard before `NestFactory.create()`
- `AppModule` is the root module where `ConfigModule.forRoot({ isGlobal: true })` will be imported
- No existing dependencies on Jest at runtime — all Jest references are devDependencies and the jest config block in `package.json`

</code_context>

<specifics>
## Specific Ideas

No specific references or examples provided — open to standard approaches within the constraints above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-15*
