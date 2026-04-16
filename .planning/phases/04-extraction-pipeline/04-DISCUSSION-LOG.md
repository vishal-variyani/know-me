# Phase 4: Extraction Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 04-extraction-pipeline
**Mode:** discuss (user-provided spec)
**Areas discussed:** Pipeline Architecture, Classify Node, Extract Node, Validate Node, Store Node, State/Routing, BullMQ, fact_type enum

---

## Pipeline Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| User-provided spec | Detailed 4-node pipeline spec provided by user in freeform message | ✓ |
| Gray area discussion | Standard interactive gray area Q&A | |

**User's choice:** User provided a comprehensive spec covering all 4 nodes, ExtractionState shape, and conditional edge routing directly in freeform text rather than through option selection.

**Notes:** The user's spec diverges significantly from REQUIREMENTS.md in several places — notably Classify (rule-based vs LLM), Validate (deterministic vs LLM arbitration), and Extract output schema. These overrides are documented in CONTEXT.md canonical_refs with explicit "overridden by" notes.

---

## Classify Node

| Option | Description | Selected |
|--------|-------------|----------|
| Rule-based (no LLM) | Proper nouns check + trivial greeting filter; ~30-40% filter rate | ✓ |
| GPT-4o-mini (REQUIREMENTS.md default) | LLM determines shouldExtract and categories[] | |

**User's choice:** Rule-based. Zero LLM cost at classify stage is a deliberate cost/latency optimization.

---

## Extract Node

| Option | Description | Selected |
|--------|-------------|----------|
| New schema: people/topics/emotionalTone/keyFacts | Structured output with separate people array, topics, tone, and user facts | ✓ |
| Old schema: MemoryFact[] with HIGH/MEDIUM/LOW confidence | Per REQUIREMENTS.md EXTR-04 | |

**User's choice:** New schema. Extract returns `{ people[], topics[], emotionalTone, keyFacts[] }`.

**Notes:** Retry-once logic on failure; empty result on second failure is a no-op at Store.

---

## Validate Node

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic only | class-validator + name normalization + within-batch dedup + synonym mapping | ✓ |
| LLM arbitration (REQUIREMENTS.md default) | GPT-4o-mini UPDATE/APPEND/IGNORE for contradictions | |

**User's choice:** Deterministic. No LLM calls in Validate. Cross-session dedup moves to Store layer.

---

## fact_type Enum

| Option | Description | Selected |
|--------|-------------|----------|
| Override DB enum | Change to fact\|preference\|relationship\|emotion; requires migration | ✓ |
| Map to existing enum | Keep preference\|relationship\|event\|belief\|goal\|habit; map at Store time | |

**User's choice:** Override. New enum is the source of truth; migration required.

---

## Cross-Session Deduplication

| Option | Description | Selected |
|--------|-------------|----------|
| Store handles it | MemoryService.upsertMemoryEntry() 0.90 cosine guard at Store time | ✓ |
| Validate checks DB too | MemoryService.findSimilar() per fact in Validate — earlier catch, extra DB round-trip | |

**User's choice:** Store handles it. Validate only deduplicates within-batch.

---

## last_mentioned_at / People Timestamp

| Option | Description | Selected |
|--------|-------------|----------|
| Use updated_at | Existing column; no migration | ✓ |
| Add last_mentioned_at | Dedicated column; more semantic; requires migration | |

**User's choice:** Use updated_at. No new column needed.

---

## Claude's Discretion

- Exact ChatPromptTemplate wording for Extract node
- Emotional tone enum values
- Relationship synonym mapping table contents
- BullMQ exponential backoff intervals
- ExtractionProcessor vs ExtractionService as graph host

## Deferred Ideas

None.
