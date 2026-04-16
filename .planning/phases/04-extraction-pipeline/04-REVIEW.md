---
phase: 04-extraction-pipeline
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - package.json
  - src/app.module.ts
  - src/extraction/extraction.module.ts
  - src/extraction/extraction.processor.ts
  - src/extraction/extraction.service.ts
  - src/extraction/extraction.types.ts
  - src/extraction/nodes/classify.node.spec.ts
  - src/extraction/nodes/classify.node.ts
  - src/extraction/nodes/extract.node.spec.ts
  - src/extraction/nodes/extract.node.ts
  - src/extraction/nodes/store.node.ts
  - src/extraction/nodes/validate.node.spec.ts
  - src/extraction/nodes/validate.node.ts
  - src/memory/memory.types.ts
  - supabase/migrations/20260416000000_fact_type_constraint.sql
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

The Phase 4 extraction pipeline is well-structured overall. The factory pattern for LangGraph nodes keeps dependencies explicit and unit-testable, the retry/absorb strategy in `extract.node.ts` is sound, and the validate node's normalization logic is thorough. The migration is correct and the `FactType` union in `memory.types.ts` aligns with the new constraint.

Four warnings were found — all logic/correctness issues: a no-op SQL UPDATE in the migration, a routing bug where the validate conditional edge can route to `store` even when `extractResult` is empty, a classification gap where single-word proper nouns that are also the entire message will be incorrectly classified, and unbounded content being forwarded to the LLM with no length guard. Three informational items are also noted.

## Warnings

### WR-01: Migration contains a no-op UPDATE that silently does nothing

**File:** `supabase/migrations/20260416000000_fact_type_constraint.sql:12-13`
**Issue:** The second UPDATE statement maps `fact_type = 'emotion'` to itself. Because `'emotion'` was already a valid value under the old constraint (it is absent from the old-values comment but present in the new), this is a no-op. More critically, the old constraint comment lists `preference | relationship | event | belief | goal | habit` as old values — `emotion` is not in that list. If `emotion` rows exist and the old constraint did not include `emotion`, they would already be violating the old constraint and could not exist. The comment and the UPDATE are misleading and will confuse future maintainers about the actual old schema state.

**Fix:** Remove the no-op UPDATE and update the comment to accurately reflect which values were actually valid under the old constraint. If `emotion` was indeed already a valid old value, add it to the comment. If it was not, remove the UPDATE entirely.
```sql
-- Accurate comment:
-- Old values: preference | relationship | event | belief | goal | habit
-- (emotion was NOT a prior value; no rows to back-fill)
UPDATE memory_entries
SET fact_type = 'fact'
WHERE fact_type IN ('event', 'belief', 'goal', 'habit');

-- Remove the no-op line entirely.
```

---

### WR-02: Validate conditional edge routes to `store` on any defined `validateResult`, including an empty one that should be END

**File:** `src/extraction/extraction.service.ts:109-113`
**Issue:** The conditional edge after `validate` routes to `store` whenever `state.validateResult !== undefined`. However, `validateNode` can return `{ validateResult: undefined }` explicitly (lines 86 and 101 of `validate.node.ts`), so when the result is `undefined` it correctly goes to END. The problem is that `storeNode` also has its own guard (`if (!validateResult) return { storeResult: { persisted: 0 } }`) — meaning if `validateResult` were somehow set to a defined-but-empty value, the routing would proceed to store unnecessarily.

The more concrete risk is the mirror case: the routing condition `state.validateResult !== undefined` is the sole guard. If LangGraph state merging ever leaves `validateResult` as a stale truthy value from a previous run of the same graph instance (the graph is compiled once and reused), `store` would be invoked with an old `validateResult`. Each `runGraph` call constructs a fresh `initialState` without `validateResult`, so LangGraph's last-write-wins reducer should overwrite it. However, `makeStateChannels` uses `default: () => undefined` for all channels, and a fresh invocation should initialize all channels to `undefined`. This is the expected behavior but relies on LangGraph's internal channel reset between `.invoke()` calls, which is not explicitly tested.

**Fix:** Add an integration-level test (or a comment with explicit verification) confirming that `validateResult` is `undefined` in the initial state channels for each new `.invoke()` call. Additionally, tighten the routing condition to be more defensive:
```typescript
builder.addConditionalEdges(
  'validate',
  (state: ExtractionState) =>
    state.validateResult != null &&
    (state.validateResult.people.length > 0 || state.validateResult.keyFacts.length > 0)
      ? 'store'
      : END,
);
```

---

### WR-03: `classifyNode` has a false-negative for single-word proper nouns that are the entire content

**File:** `src/extraction/nodes/classify.node.ts:19-35`
**Issue:** `hasProperNounInContent` checks words at index >= 1 for unambiguous proper nouns and also checks index 0 only when `words.length >= 3`. A message like `"Sarah"` (a single word) will return `false` because: there are no words at index >= 1, and `words.length >= 3` is false. The message `"Sarah?"` or `"Sarah!"` would similarly produce `shouldExtract = false`. This is unlikely to carry extractable content in isolation, but a message such as `"Jake."` as an acknowledgement of a person's name would be silently dropped when the user might expect the system to recognize it.

The more impactful case is two-word messages: `"My Sarah"` — only 2 words, `words.length >= 3` is false, so index 0 (`My`) is not checked as a proper noun. Index 1 (`Sarah`) has an uppercase first letter followed by lowercase letters and passes `/^[A-Z][a-z]{1,}$/`, so this case is actually fine. But `"Jake visited"` — index 1 is `visited` (no leading uppercase), index 0 is `Jake` but `words.length < 3` — this returns `false`, missing a proper noun.

**Fix:** Either lower the word-count threshold for the first-word check, or use a smarter heuristic (e.g., check the first word unconditionally but exclude known sentence-starters like `I`, `The`, `A`, `An`):
```typescript
const SENTENCE_STARTERS = new Set(['i', 'the', 'a', 'an', 'my', 'our', 'your', 'their', 'its']);

function hasProperNounInContent(content: string): boolean {
  const words = content.trim().split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '');
    if (!word) continue;
    // Skip index 0 only if it looks like a common sentence-starter
    if (i === 0 && SENTENCE_STARTERS.has(word.toLowerCase())) continue;
    if (/^[A-Z][a-z]{1,}$/.test(word)) return true;
  }

  return false;
}
```

---

### WR-04: No content length guard before the LLM call — large payloads will be forwarded unchecked

**File:** `src/extraction/nodes/extract.node.ts:88-103`
**Issue:** `extractNode` forwards `state.content` directly to the LLM with no character/token length limit. If a caller enqueues a very large document or conversation transcript, the entire payload is sent to the model. This has two practical consequences: (1) cost explosion for large documents since the `enqueue` API accepts arbitrary `text` with no validation, and (2) potential failure if the content exceeds the model's context window, which will trigger the retry path and ultimately absorb silently, losing the extraction entirely. The `enqueue` method in `extraction.service.ts` (line 127) also performs no content length check.

**Fix:** Add a length guard in either `enqueue` or `extractNode`. Truncating in the node is the safest location since it is closer to the LLM call:
```typescript
const MAX_CONTENT_CHARS = 8000; // ~2k tokens for gpt-4o-mini

return async function extractNode(state: ExtractionState): Promise<Partial<ExtractionState>> {
  const raw = state.content;
  const content = raw.length > MAX_CONTENT_CHARS
    ? raw.slice(0, MAX_CONTENT_CHARS)
    : raw;
  // ...rest of the function using `content` instead of `state.content`
```

Alternatively, validate and reject in `ExtractionService.enqueue`:
```typescript
if (text.length > 32_000) {
  this.logger.warn(`enqueue: content too long (${text.length} chars), truncating`);
  text = text.slice(0, 32_000);
}
```

---

## Info

### IN-01: `makeStateChannels` hardcodes field names as strings — out of sync risk with `ExtractionState`

**File:** `src/extraction/extraction.service.ts:23-38`
**Issue:** The `fields` array inside `makeStateChannels` lists all `ExtractionState` keys as typed `keyof ExtractionState` strings. This provides compile-time safety. However, adding a new field to `ExtractionState` without updating `makeStateChannels` will silently result in that field not being tracked by LangGraph's channel system, producing hard-to-diagnose state loss. The TypeScript `keyof` type constraint helps catch typos but does NOT enforce exhaustiveness — new fields will not produce a compile error if omitted.

**Fix:** Consider using a mapped type or a helper that derives the channel definitions directly from the type, or add a comment pointing future contributors to update `makeStateChannels` whenever `ExtractionState` gains a new field. A lint rule or an exhaustiveness assertion could also enforce this.

---

### IN-02: `classify.node.spec.ts` does not test the two-word proper noun edge case

**File:** `src/extraction/nodes/classify.node.spec.ts:1-52`
**Issue:** The test suite covers trivial patterns, no-proper-noun messages, and three-or-more-word proper noun messages, but does not test the two-word case identified in WR-03 (`"Jake visited"`, `"Sarah left"`). The gap means the off-by-one in the three-word threshold is not caught by any existing test.

**Fix:** Add a test case:
```typescript
it('returns true for two-word message starting with proper noun', () => {
  expect(
    classifyNode(makeState('Jake visited')).classifyResult?.shouldExtract,
  ).toBe(true);
});
```

---

### IN-03: `store.node.ts` has no test file

**File:** `src/extraction/nodes/store.node.ts`
**Issue:** All other nodes (`classify`, `extract`, `validate`) have spec files. `store.node.ts` has none. It contains non-trivial logic: people upsert, keyFact embedding + memory upsert, per-item error isolation, and the `persisted` counter. This is the only node that performs I/O and has the most side effects.

**Fix:** Create `src/extraction/nodes/store.node.spec.ts` covering at least: (1) that `upsertPerson` is called once per person, (2) that `embed` + `upsertMemoryEntry` are called once per keyFact, (3) that a single-item failure does not abort remaining items, and (4) that `persisted` reflects the count of successful operations.

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
