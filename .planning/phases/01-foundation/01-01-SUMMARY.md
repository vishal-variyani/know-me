---
phase: 01-foundation
plan: 01
subsystem: testing
tags: [vitest, swc, typescript, nestjs, jest]

requires: []
provides:
  - Vitest 2.x test runner with unplugin-swc for NestJS decorator metadata support
  - noImplicitAny: true TypeScript strictness
  - AppController DI smoke test passing under Vitest

affects: [all future phases that write tests]

tech-stack:
  added: [vitest@2.1.9, unplugin-swc@1.5.9, @swc/core@1.15.26, @vitest/coverage-v8@2.1.9]
  patterns: [vitest.config.ts with pool:forks + swc.vite plugin]

key-files:
  created: [vitest.config.ts]
  modified: [package.json, tsconfig.json]

key-decisions:
  - "pool:forks chosen over threads — Vitest 2.x threads mode is broken with NestJS DI (GitHub #6090)"
  - "module.type:nodenext in swc.vite options to match tsconfig module:nodenext"
  - "@vitest/coverage-v8 pinned to 2.1.9 to match vitest version (pnpm flagged peer conflict with 4.x)"

patterns-established:
  - "Test config pattern: vitest.config.ts with unplugin-swc at project root"
  - "SWC decorator metadata: swc.vite({ module: { type: 'nodenext' } }) enables emitDecoratorMetadata"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

duration: 15min
completed: 2026-04-15
---

# Plan 01-01: Vitest + SWC Test Scaffold Summary

**Vitest 2.x with unplugin-swc replaces Jest — NestJS DI smoke test passes confirming decorator metadata is emitted**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-15T16:30:00Z
- **Completed:** 2026-04-15T16:45:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Removed jest, @types/jest, ts-jest; zero Jest references remain in any config
- Vitest 2.1.9 installed with unplugin-swc using pool:forks (avoids Vitest 2.x threads regression)
- NestJS DI resolves under SWC: `appController.getHello()` returns `'Hello World!'` (1 test, 1 passed)
- `noImplicitAny: true` enforced in tsconfig.json; `pnpm build` exits 0

## Task Commits

1. **Task 1: Remove Jest scaffold and install Vitest + SWC** - `479fd94` (feat)
2. **Task 2: Create vitest.config.ts and verify DI smoke test passes** - `f73b19c` (feat)

## Files Created/Modified
- `vitest.config.ts` — Vitest runner config with unplugin-swc, pool:forks, globals:true
- `package.json` — test scripts replaced (vitest run); jest/ts-jest/@types/jest removed
- `tsconfig.json` — noImplicitAny changed from false to true
- `pnpm-lock.yaml` — updated lockfile

## Decisions Made
- `pool: 'forks'` not `threads` — Vitest 2.x single-thread mode is broken for NestJS DI contexts (GitHub issue #6090)
- `module: { type: 'nodenext' }` in swc.vite config — must match tsconfig `"module": "nodenext"` or SWC skips decorator metadata emission
- `@vitest/coverage-v8` pinned to `2.1.9` — pnpm peer dependency check flagged `4.1.4` as incompatible with vitest@2.1.9

## Deviations from Plan

None — plan executed exactly as written. The `@vitest/coverage-v8` version pinning was required by pnpm's peer resolution but was addressed inline.

## Issues Encountered
- `pnpm approve-builds` is interactive and could not run in CI-like context; `@swc/core` native binary was pre-built for darwin-arm64 and functional without the post-install script
- CJS Vite deprecation warning emitted by Vitest 2.x internals — cosmetic, does not affect test execution

## Next Phase Readiness
- Test scaffold is ready for Phase 2 service tests
- `pnpm test` exits 0; any new `*.spec.ts` in `src/` will be picked up automatically
- No blockers

---
*Phase: 01-foundation*
*Completed: 2026-04-15*
