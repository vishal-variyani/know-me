---
phase: 01-foundation
plan: 04
subsystem: infra
tags: [nestjs, config, socket.io, env-validation, bootstrap]

requires:
  - phase: 01-01
    provides: Vitest test runner used to verify validateEnv tests

provides:
  - validateEnv() guard exported from main.ts — throws before NestFactory.create if any required var missing
  - ConfigModule.forRoot({ isGlobal: true }) in AppModule — ConfigService injectable everywhere
  - IoAdapter wired via app.useWebSocketAdapter() — Socket.io ready for Phase 3
  - src/main.spec.ts with 10 validateEnv test cases covering all 9 required vars

affects: [02-core-data-layer, 03-chat-path, 04-extraction-pipeline, 05-document-upload, 06-test-suite]

tech-stack:
  added: ['@nestjs/config@4.0.4', '@nestjs/websockets@11.1.19', '@nestjs/platform-socket.io@11.1.19']
  patterns:
    - Bootstrap guard pattern: validateEnv() before NestFactory.create()
    - Global config pattern: ConfigModule.forRoot({ isGlobal: true })
    - Vitest bootstrap guard: if (!process.env['VITEST']) { bootstrap() }

key-files:
  created: [src/main.spec.ts]
  modified: [src/main.ts, src/app.module.ts]

key-decisions:
  - "Guard bootstrap() with !process.env['VITEST'] — Vitest sets this env var; prevents unhandled rejection when test imports main.ts"
  - "validateEnv exported (not just called) — enables direct unit testing without spawning a full app"
  - ".js extensions on relative imports — required for NodeNext ESM module resolution"

patterns-established:
  - "Bootstrap guard pattern: synchronous validateEnv() before any async NestFactory call"
  - "Vitest module guard: if (!process.env['VITEST']) around module-level side effects"

requirements-completed: [INFRA-05, INFRA-06, INFRA-07]

duration: 15min
completed: 2026-04-15
---

# Plan 01-04: NestJS Bootstrap Hardening Summary

**validateEnv() guard + ConfigModule global + IoAdapter wired — app fails fast on missing env vars, ConfigService injectable everywhere, Socket.io ready**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-15T17:00:00Z
- **Completed:** 2026-04-15T17:15:00Z
- **Tasks:** 2
- **Files modified:** 3 modified, 1 created

## Accomplishments
- `validateEnv()` throws `[Bootstrap] Missing required environment variable: <name>` for all 9 required vars before `NestFactory.create()` — INFRA-06 satisfied
- `ConfigModule.forRoot({ isGlobal: true })` in AppModule — ConfigService injectable in all Phase 2-6 modules — INFRA-07 satisfied
- `IoAdapter` wired via `app.useWebSocketAdapter()` — Socket.io clients can connect — INFRA-05 satisfied
- 11 tests pass: 10 validateEnv (9 missing-var + 1 all-present) + 1 AppController smoke test

## Task Commits

1. **Task 1: Install config and WebSocket packages** - `493c4fd` (feat)
2. **Task 2: Rewrite main.ts + app.module.ts + create main.spec.ts** - `499ad4d` (feat)

## Files Created/Modified
- `src/main.ts` — validateEnv() guard + REQUIRED_ENV_VARS array + IoAdapter wiring + VITEST guard
- `src/app.module.ts` — ConfigModule.forRoot({ isGlobal: true }) added to imports
- `src/main.spec.ts` — 10 validateEnv unit tests using it.each over all 9 required vars

## Decisions Made
- `if (!process.env['VITEST']) { bootstrap() }` — Vitest sets `VITEST=true` automatically; without this guard, importing main.ts in tests triggers `bootstrap()` which calls `validateEnv()` synchronously and throws an unhandled rejection even though the actual test assertions pass
- `validateEnv` exported (not just called inline) — enables isolated unit testing without NestJS overhead
- `.js` extensions on relative imports (`./app.module.js`) — required for NodeNext ESM resolution in TypeScript

## Deviations from Plan

### Auto-fixed Issues

**1. [Unhandled rejection] Bootstrap guard for Vitest import**
- **Found during:** Task 2 (running pnpm test after creating main.spec.ts)
- **Issue:** `bootstrap()` at module level fires when Vitest imports `main.ts` for the test, causing an unhandled rejection on `validateEnv()` even though the 10 test assertions all passed
- **Fix:** Wrapped `bootstrap()` call with `if (!process.env['VITEST'])` — Vitest sets this env var automatically
- **Files modified:** src/main.ts
- **Verification:** pnpm test exits 0 with no unhandled errors, 11 tests passed
- **Committed in:** `499ad4d`

---

**Total deviations:** 1 auto-fixed (test-runner side-effect at module level)
**Impact on plan:** Fix was necessary for correct test isolation. No scope creep.

## Issues Encountered
None beyond the auto-fixed bootstrap guard.

## Next Phase Readiness
- ConfigService is globally injectable — Phase 2 database/redis modules can inject it immediately
- IoAdapter is ready — Phase 3 ChatGateway can register WebSocket handlers without additional wiring
- validateEnv covers all 9 vars — any missing env var will fail loudly at startup
- No blockers

---
*Phase: 01-foundation*
*Completed: 2026-04-15*
