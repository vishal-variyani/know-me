---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.9 |
| **Config file** | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && pnpm build` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test && pnpm build`
- **Before `/gsd-verify-work`:** `pnpm test` green + `pnpm build` clean + `docker compose ps` shows healthy + `supabase db push` applies without errors
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INFRA-01 | — | N/A | manual audit | `grep -r "jest" package.json tsconfig.json` | N/A | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-02 | — | N/A | unit/smoke | `pnpm test` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | INFRA-03 | — | N/A | build check | `pnpm build` | N/A | ⬜ pending |
| 1-02-01 | 02 | 1 | INFRA-04 | — | N/A | smoke/manual | `docker compose ps` | N/A | ⬜ pending |
| 1-03-01 | 03 | 2 | DB-01 | T-RLS | RLS enabled on all 5 tables | manual SQL | `\d` in psql + `SELECT extversion` | N/A | ⬜ pending |
| 1-03-02 | 03 | 2 | DB-02 | T-RLS | RLS enabled on all 5 tables | manual SQL | `\d` in psql | N/A | ⬜ pending |
| 1-03-03 | 03 | 2 | DB-03 | T-RLS | RLS enabled on all 5 tables | manual SQL | `\d` in psql | N/A | ⬜ pending |
| 1-03-04 | 03 | 2 | DB-04 | T-RLS | RLS enabled on all 5 tables | manual SQL | `\d` in psql | N/A | ⬜ pending |
| 1-03-05 | 03 | 2 | DB-05 | T-SECDEF | SECURITY INVOKER + explicit user_id filter | manual SQL | psql function inspect | N/A | ⬜ pending |
| 1-03-06 | 03 | 2 | DB-06 | — | N/A | manual SQL | `\d` in psql | N/A | ⬜ pending |
| 1-03-07 | 03 | 2 | DB-07 | — | N/A | manual SQL | `\d` in psql | N/A | ⬜ pending |
| 1-04-01 | 04 | 2 | INFRA-06 | T-ENVLEAK | .env in .gitignore; .env.example provided | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 2 | INFRA-07 | — | N/A | unit (DI smoke) | `pnpm test` | ❌ W0 | ⬜ pending |
| 1-04-03 | 04 | 2 | INFRA-05 | — | N/A | manual smoke | Connect with socket.io-client | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — must exist before any `pnpm test` invocation (Plan 01-01, Wave 1)
- [ ] `src/app.controller.spec.ts` — convert from Jest to Vitest (remove `@types/jest` import, rely on vitest globals)
- [ ] `src/main.spec.ts` (recommended) — test `validateEnv()` throws with specific missing var name

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker containers healthy | INFRA-04 | Docker not available in CI shell | Run `docker compose up -d && docker compose ps`; confirm all containers show `healthy` |
| pgvector extension loaded | DB-01 | Docker-dependent | `SELECT extversion FROM pg_extension WHERE extname = 'vector';` via psql |
| All 5 tables with correct schema | DB-01–DB-04 | Migration-dependent | `\d` in psql after `supabase db push`; verify column names, types, RLS status |
| HNSW indexes present | DB-06 | Migration-dependent | `\di` in psql; confirm hnsw indexes on vector columns |
| B-tree user_id indexes present | DB-07 | Migration-dependent | `\di` in psql; confirm btree indexes on user_id columns |
| Socket.io client can connect | INFRA-05 | Runtime smoke | Start app, connect with `socket.io-client`, verify emit/receive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
