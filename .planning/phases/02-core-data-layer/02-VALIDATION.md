---
phase: 2
slug: core-data-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (via NestJS) |
| **Config file** | `jest.config.js` or `package.json#jest` |
| **Quick run command** | `npm test -- --testPathPattern=src` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=src`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | EMBED-01 | — | N/A | unit | `npm test -- --testPathPattern=embedding` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | EMBED-02 | — | Startup fails if EMBEDDING_DIMS != 1536 | unit | `npm test -- --testPathPattern=embedding` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 1 | EMBED-03 | — | N/A | unit | `npm test -- --testPathPattern=database` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | MEM-01 | — | N/A | unit | `npm test -- --testPathPattern=memory` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | MEM-02 | — | Results scoped to user_id only | unit | `npm test -- --testPathPattern=memory` | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | MEM-03 | — | Cosine < 0.90 inserts; >= 0.90 updates | unit | `npm test -- --testPathPattern=memory` | ❌ W0 | ⬜ pending |
| 2-02-04 | 02 | 1 | MEM-04 | — | N/A | unit | `npm test -- --testPathPattern=memory` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | MEM-05 | — | N/A | unit | `npm test -- --testPathPattern=people` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | MEM-06 | — | user_id filter enforced on all queries | unit | `npm test -- --testPathPattern=people` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/embedding/embedding.service.spec.ts` — stubs for EMBED-01, EMBED-02
- [ ] `src/database/database.module.spec.ts` — stubs for EMBED-03
- [ ] `src/memory/memory.service.spec.ts` — stubs for MEM-01, MEM-02, MEM-03, MEM-04
- [ ] `src/memory/people.service.spec.ts` — stubs for MEM-05, MEM-06

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `compromise` ESM import works under `"module": "nodenext"` | MEM-05 | Module system interop requires runtime smoke test | Run `node -e "import('compromise').then(m => console.log(m.default('Hello Sarah').people().out('array')))"` in project root |
| `pgvector.registerTypes(client)` called on pool connect | EMBED-03 | Requires live DB connection | Start app and confirm vector INSERT/SELECT round-trips without coercion errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
