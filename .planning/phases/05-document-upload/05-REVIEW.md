---
phase: 05-document-upload
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - package.json
  - pnpm-lock.yaml
  - src/app.module.ts
  - src/upload/upload.controller.spec.ts
  - src/upload/upload.controller.ts
  - src/upload/upload.module.ts
  - src/upload/upload.types.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

The upload feature is compact and well-structured. The controller performs the right validation sequence (userId → file presence → extension → size → content), uses multer's in-memory storage correctly, and delegates to ExtractionService via a single `enqueue` call. The type file is minimal and correct. The module wiring is clean.

Three warnings deserve attention before shipping: (1) a path-traversal / Unicode bypass in the extension extraction logic, (2) no multer `limits` guard on the Express layer (the 50 KB check happens in-process after the full buffer is already read), and (3) the test suite uses `vi.*` globals without importing them, which will silently fail if the Vitest `globals` option is ever turned off. Three info-level items cover a missing MIME-type guard, a single-use file type that could be an enum, and the `ExtractionModule` double-registration pattern.

## Warnings

### WR-01: Extension extraction is bypassable with Unicode dot characters or dotless filenames

**File:** `src/upload/upload.controller.ts:53`
**Issue:** `file.originalname.slice(file.originalname.lastIndexOf('.'))` returns `""` when the filename contains no `.`, and returns the full filename when the only dot is at position 0 (e.g. `".env"`). An attacker can also craft a filename with a Unicode fullwidth full stop (U+FF0E) to produce an extension that does not match the `ALLOWED_EXTENSIONS` set, yet the file is silently accepted after the condition below it. Wait — actually the opposite: a name like `evil` (no dot) produces `lastIndexOf('.')` of `-1`, `slice(-1)` returns the last character, which almost certainly won't be in `ALLOWED_EXTENSIONS` so the call throws 415. However a name like `.txt` (dot at index 0) produces `slice(0)` which is the full string `".txt"` — that accidentally passes because `".txt"` equals the set member `".txt"`. The real risk is a name like `notes.txt.exe`: `lastIndexOf('.')` correctly finds `.exe` so that is already blocked. The subtle edge-case is a dotless filename: `slice(-1)` returns the last character. If that character happens to be one of `{t, d}` it will NOT match `".txt"` or `".md"` so it stays blocked — but this is fragile accidental correctness, not intentional. The more dangerous case is an empty `originalname` string: `''.lastIndexOf('.')` returns `-1`, `''.slice(-1)` returns `""`, `ALLOWED_EXTENSIONS.has("")` is `false` — throws 415. So the current code is not exploitable today, but it is brittle. The safest fix is an explicit extension parse that rejects any name with no dot outright.

**Fix:**
```typescript
// Replace line 53 with:
const dotIdx = file.originalname.lastIndexOf('.');
if (dotIdx === -1) {
  throw new UnsupportedMediaTypeException(
    'File must have an explicit extension (.txt or .md)',
  );
}
const ext = file.originalname.slice(dotIdx).toLowerCase();
```

---

### WR-02: No multer `limits` configuration — 50 KB guard triggers only after the full buffer is loaded

**File:** `src/upload/upload.controller.ts:31`
**Issue:** `@UseInterceptors(FileInterceptor('file'))` uses multer with default settings, meaning Express/multer reads the entire request body into memory before the controller method is called. The `file.size > MAX_FILE_BYTES` check on line 61 fires only after the buffer is already in memory. A client sending a multi-megabyte upload will consume server memory before it is rejected. The `multer` package supports a `limits.fileSize` option that causes it to abort the stream before buffering completes.

**Fix:**
```typescript
@UseInterceptors(
  FileInterceptor('file', {
    storage: multer.memoryStorage(),   // already the default, made explicit
    limits: { fileSize: 50 * 1024 },  // 50 KB — abort before full buffer read
  }),
)
```
Import `multer` at the top: `import multer from 'multer';`. When the limit is exceeded multer throws a `MulterError` with code `LIMIT_FILE_SIZE`; add an `ExceptionFilter` or a try/catch in the controller to convert it to a `BadRequestException`.

---

### WR-03: Test file uses `vi` global without importing it — relies on implicit Vitest globals

**File:** `src/upload/upload.controller.spec.ts:11`
**Issue:** `vi.fn()`, `vi.clearAllMocks()` are used without importing `vi` from `'vitest'`. This works only when Vitest is configured with `globals: true`. If that option is absent or disabled, the test file will throw `ReferenceError: vi is not defined` at runtime with no compile-time warning. The existing test files in the project (e.g. `src/llm/llm.service.spec.ts`) follow the same pattern, so this is likely intentional — but it creates a hidden coupling to the globals config that is worth making explicit.

**Fix:**
```typescript
// Add at the top of the file, alongside other imports:
import { vi } from 'vitest';
```
This is harmless when globals are enabled and makes the dependency explicit.

## Info

### IN-01: MIME type is not validated — extension spoofing via renamed files is possible

**File:** `src/upload/upload.controller.ts:52-58`
**Issue:** The controller validates only the file extension, not the `file.mimetype` field. A client can rename `evil.exe` to `evil.txt` and the controller will accept it. Because the file content is only read as a UTF-8 string for enqueuing, this does not create an RCE vector in the current pipeline, but it weakens the intent of the file-type guard and is worth tightening for defence-in-depth.

**Fix:** Add a MIME allowlist alongside the extension check:
```typescript
const ALLOWED_MIMETYPES = new Set(['text/plain', 'text/markdown']);
// After the extension check:
if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
  throw new UnsupportedMediaTypeException(
    `Unsupported MIME type "${file.mimetype}". Only text/plain and text/markdown are accepted`,
  );
}
```

---

### IN-02: `sourceType` literal `'document'` is a magic string — consider sharing the union type

**File:** `src/upload/upload.controller.ts:74`
**Issue:** The string `'document'` is passed as the `sourceType` argument to `ExtractionService.enqueue()`. The union type `'conversation' | 'document'` is defined inside `extraction.service.ts` (inferred from the method signature). If the union is ever changed, the call site has no compile-time guard unless TypeScript happens to check the literal inline. Extracting the union to a shared type (e.g., in `extraction.types.ts`) and importing it in the controller would make the coupling explicit and provide better error messages at the call site.

**Fix:** In `src/extraction/extraction.types.ts`, export:
```typescript
export type SourceType = 'conversation' | 'document';
```
Then import and use `SourceType` in both the service signature and the controller call.

---

### IN-03: `ExtractionModule` is registered twice in `AppModule`

**File:** `src/app.module.ts:9`
**Issue:** `ExtractionModule` is imported directly in `AppModule` (line 10) and is also a transitive import via `UploadModule` (which imports `ExtractionModule`). NestJS deduplicates module imports by reference, so there is no runtime error, but the explicit import in `AppModule` is redundant now that `UploadModule` owns that dependency. Keeping it explicit is also a valid pattern for "global availability," but if that is the intent it should be documented with a comment.

**Fix:** Either remove `ExtractionModule` from `AppModule.imports` (rely on `UploadModule`'s transitive registration) or add a comment clarifying the intent:
```typescript
// ExtractionModule is also imported by UploadModule; listed here for
// explicit global availability (ChatGateway depends on it directly).
ExtractionModule,
```

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
