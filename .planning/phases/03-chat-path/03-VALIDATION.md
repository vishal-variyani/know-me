---
phase: 3
slug: chat-path
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x + unplugin-swc |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test --run` |
| **Full suite command** | `pnpm test --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --run`
- **After every plan wave:** Run `pnpm test --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | RETR-01 | — | N/A | unit | `pnpm test --run src/retrieval` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | RETR-02 | — | N/A | unit | `pnpm test --run src/retrieval` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | RETR-03 | — | N/A | unit | `pnpm test --run src/retrieval` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | RETR-04 | — | N/A | unit | `pnpm test --run src/retrieval` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | CHAT-04 | — | N/A | unit | `pnpm test --run src/llm` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | CHAT-05 | — | N/A | unit | `pnpm test --run src/llm` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | CHAT-07 | — | Memory block injected only above threshold | unit | `pnpm test --run src/llm` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | CHAT-01 | — | N/A | unit | `pnpm test --run src/chat` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | CHAT-02 | T-03-01 | UUID validation rejects non-UUID on connect | unit | `pnpm test --run src/chat` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | CHAT-06 | — | void enqueue — gateway never awaits | unit | `pnpm test --run src/chat` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 2 | CHAT-03 | — | AbortController stops stream on disconnect | unit | `pnpm test --run src/chat` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/retrieval/retrieval.service.spec.ts` — stubs for RETR-01 through RETR-04
- [ ] `src/llm/llm.service.spec.ts` — stubs for CHAT-04, CHAT-05, CHAT-07
- [ ] `src/chat/chat.gateway.spec.ts` — stubs for CHAT-01, CHAT-02, CHAT-03, CHAT-06

*Existing Vitest + SWC infrastructure from Phase 1 covers all framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Socket.io client receives chat:chunk stream + chat:complete | CHAT-01 | Requires live Socket.io client connection | Run `docker compose up -d`, start app, connect Socket.io client with valid userId, send `chat:send`, verify token chunks arrive and chat:complete fires |
| Mid-stream disconnect aborts LLM call | CHAT-03 | Requires live connection + timing | Connect, send long message, disconnect mid-stream, verify no continued log output from LlmService |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
