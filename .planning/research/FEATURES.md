# Features Research: Know Me

**Confidence:** MEDIUM-HIGH (MemGPT/Letta, ChatGPT Memory, Mem.ai, Rewind, Pi, Hume AI)

---

## Table Stakes

Features users expect from any memory-backed AI system. Missing any of these = degraded baseline experience.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Persistent memory across sessions** | Without this, every conversation starts cold — no differentiation from vanilla LLM chat | Low | Core schema already in design |
| **Fact extraction from conversation** | Users expect the system to "learn" them automatically without manual tagging | Medium | LangGraph pipeline already planned |
| **Personalized responses using stored memory** | The entire value proposition — responses that feel personally aware | Medium | Hybrid retrieval already in design |
| **Social graph awareness (named people)** | Users constantly reference "my wife Sarah", "my manager Tom" — pure vector retrieval misses these | Medium | `people` table + name-mention trigger lookup already planned |
| **Deduplication of facts** | Without this, "lives in Austin" accumulates across hundreds of messages, polluting retrieval | High | NOT yet in design — needs explicit handling in Validate node |
| **Contradiction resolution** | User says "I'm vegetarian" in April, "I love burgers" in June — system must prefer newer or reconcile | High | NOT yet in design — critical for data quality at scale |
| **Memory retrieval on demand** | Users expect to ask "what do you know about me?" and get a coherent answer | Low | Needs a dedicated query path beyond embedding search |
| **Document/journal ingestion** | Power users want to bulk-import knowledge (past journals, notes) — expected in 2025 | Medium | REST endpoint already planned; same extraction pipeline |
| **Per-user data isolation** | Multi-tenant system must guarantee user A never sees user B's memories | Low | RLS on all tables already in design |
| **Graceful memory miss** | When retrieval finds nothing relevant, response must still be useful — no hallucination | Low | Prompt engineering concern — fallback to non-personalized response |

---

## Differentiators

Features that make Know Me worth building. Not universally expected, but meaningfully valuable when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Typed memory with confidence scores** | Storing `fact_type: preference`, `confidence: 0.9` vs raw text enables selective retrieval and decay | Medium | Requires schema field on `memory_entries`; enables all downstream quality features |
| **Temporal awareness / recency weighting** | "I used to smoke but quit last year" — recency in retrieval re-ranking means newer facts outrank older ones | Medium | Cosine similarity alone ignores time; add recency as re-ranking multiplier |
| **Bidirectional social graph** | Know not just "Sarah is my wife" but also what the user has said about Sarah's preferences, job, health | High | `people` table + per-person `memory_entries` partitioned by `person_id` |
| **Memory summarization / compression** | As `memory_entries` grows (1000s of entries), retrieval degrades; periodic summarization collapses redundant facts | High | Background job — needed after 3-6 months of heavy use |
| **Explicit memory editing API** | Allow users to correct wrong facts via REST ("actually I moved to Seattle") — high-trust control signal | Low | Simple CRUD on `memory_entries` — builds user trust significantly |
| **Memory confidence degradation (forgetting)** | Facts not reinforced decay in confidence; prevents stale facts (old job, old city) from dominating retrieval | High | Requires scheduled scoring job + `confidence` and `last_reinforced_at` on entries |
| **Extraction classification taxonomy** | Facts classified as: preference / relationship / event / belief / goal / habit — enables selective injection and different retention rules per class | Medium | Validate node of LangGraph pipeline |
| **Bulk memory export** | GDPR-style data portability — export all memories as structured JSON | Low | Table dump with ownership filter; builds user trust; low cost |

---

## Anti-Features (Avoid in v1)

Things that seem obviously useful but add disproportionate complexity for a v1 backend.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Frontend / client UI** | Already out of scope; noted because feature creep pressure is real | Expose clean REST + WebSocket API contracts and document them |
| **Real-time collaborative memory** | Sharing memories across users multiplies ownership ambiguity | Solve per-user first; add `shared_user_id` FK later if genuinely needed |
| **Multi-modal memory (images, audio)** | Requires separate embedding pipelines, storage layer, OCR/ASR — trebles complexity | Text-only extraction for v1; design `memory_entries.source_type` column to allow extension |
| **Manual memory organization (tagging, folders)** | Users expect AI to organize for them; manual systems become maintenance burden | Classification taxonomy does this without user effort |
| **Memory-to-memory linking / knowledge graph** | Building explicit edges requires graph DB reasoning — not pgvector's strength | Rely on embedding similarity for implicit linking; explicit graph is v3+ |
| **Plugin / integration ecosystem** | Connecting to calendar, email, Spotify as memory sources is a product in itself | Single ingestion path: WebSocket chat + REST document upload only |
| **Fine-tuned user-specific models** | Personalization via LoRA per user — operationally brutal at multi-user scale | Retrieval-augmented personalization is the correct v1 approach |
| **Memory versioning / full audit log** | Full history of every change to every memory fact — complex schema, query overhead | Store `updated_at` and `confidence`; full version table is v2+ |
| **Proactive memory surfacing (push notifications)** | Requires scheduler, notification system, user preference management | Let users pull; proactive push is a separate product surface |
| **Sentiment / emotional state tracking** | Requires affective NLP pipeline, raises privacy concerns | Focus on factual memory; sentiment is a dimension, not a foundation |

---

## Memory-Specific Patterns

### Conflict and Contradiction Resolution

**The problem:** User states contradictory facts at different times ("I'm a vegetarian" in April / "I had a steak last night" in June).

**Production patterns:**
- **Timestamp wins (naive):** Newer assertion replaces older for the same fact key. Simple but brittle.
- **Confidence-weighted merge:** Both facts stored with confidence scores; retrieval returns highest-confidence + recency-boosted fact.
- **LLM arbitration at validation:** The Validate node is passed both the new extracted fact AND the existing fact on the same topic. LLM decides: `UPDATE` / `APPEND` / `IGNORE` / `CONFLICT`.

**Recommended for Know Me:** LLM arbitration in the Validate node. Before storing a new fact, query `memory_entries` for existing entries with cosine similarity > 0.85. Pass both to Validate prompt: "Given existing memory X and new statement Y, should we update, append, ignore, or flag as conflict?" This scales without requiring a rigid fact ontology.

---

### Deduplication

**The problem:** "Lives in Austin" appears across 47 messages. Storing all 47 creates retrieval noise and token waste.

**Production patterns:**
- **Embedding similarity threshold:** Before storing, compute embedding of new fact, query for cosine similarity > 0.90-0.92. If match found, UPDATE `last_reinforced_at` and increment confidence rather than INSERT.
- **Canonical key matching:** Structured facts deduplicated on exact key. Requires typed extraction.
- **Periodic consolidation job:** Nightly background job clusters similar embeddings, merges clusters into canonical facts.

**Recommended for Know Me:** Embedding similarity check in the Store node before INSERT. If similarity > 0.90 to an existing entry with same `user_id`, UPDATE `last_reinforced_at` + bump `confidence`. Periodic consolidation job in v2.

---

### Forgetting / Memory Decay

**The problem:** A fact from 18 months ago ("job at Acme Corp") may be wrong today.

**Production patterns:**
- **Time-decay scoring:** `retrieval_score = cosine_similarity * exp(-lambda * days_since_last_reinforced)`. Lambda tuned per fact type.
- **Confidence floor:** Facts with confidence below 0.2-0.3 excluded from retrieval but retained in DB.
- **Explicit TTL per fact type:** Preference facts TTL = 180 days; identity facts never expire; event facts expire after event date.

**Recommended for Know Me:** Add `confidence` (float 0.0-1.0) and `last_reinforced_at` (timestamp) to `memory_entries`. Retrieval re-ranking multiplies cosine score by recency factor. Scheduled weekly job decrements confidence on unreinforced facts. Confidence < 0.2 triggers soft-delete.

---

### Retrieval Quality

**The problem:** Top-k=5 cosine similarity returns semantically related but contextually irrelevant memories.

**Production patterns:**
- **Hybrid retrieval (already in design):** pgvector semantic + exact lookup for named entities. Correct call.
- **Retrieval filtering by fact type:** Only inject preference and relationship facts into general chat context; inject goal and event facts only when the query is goal/planning-oriented.
- **Query expansion:** LLM generates 2-3 alternative phrasings to broaden semantic net.
- **Re-ranking:** Retrieved top-20 results re-ranked by relevance before truncating to top-5.

**Recommended for Know Me:** Ship with hybrid retrieval as designed. Add `fact_type` filtering as a second pass (low complexity, high signal). Query expansion and re-ranking are v2 optimizations.

---

### Memory Injection Format

**The problem:** Injecting retrieved memories verbatim as prose bloats the prompt and introduces LLM confusion.

**Production patterns:**
- **Structured memory block:** `[Memory: user prefers morning meetings | confidence: 0.9 | last confirmed: 2026-03-01]`. Predictable format the LLM can reliably condition on.
- **Summarization before injection:** Cluster retrieved memories by topic, summarize each cluster to 1 sentence.
- **Relevance-threshold gating:** Only inject memories scoring above a threshold for the current turn.

**Recommended for Know Me:** Structured memory block for v1. Add relevance-threshold gating so off-topic memories don't inject when irrelevant. Summarization is a v2 optimization.

---

## Feature Dependencies

```
[Schema: conversations + memory_entries + people tables]
    └─> [Fact Extraction Pipeline: Classify → Extract → Validate → Store]
            └─> [Deduplication]            (needs existing entries to check against)
            └─> [Contradiction Resolution] (needs existing entries to compare)
            └─> [Confidence Scoring]       (produced by Validate node)
                    └─> [Memory Decay]                      (needs confidence + last_reinforced_at)
                    └─> [Retrieval Filtering by Confidence] (needs confidence field)

[Embedding generation: text-embedding-3-small]
    └─> [pgvector Semantic Retrieval]
            └─> [Hybrid Retrieval: semantic + people lookup]
                    └─> [Personalized Chat Response]
                    └─> [Retrieval Re-ranking]       (v2)

[People Table]
    └─> [Named-entity trigger lookup]
            └─> [Bidirectional social graph]   (v2)

[memory_entries.fact_type field]
    └─> [Retrieval filtering by fact type]
    └─> [Extraction classification taxonomy]
    └─> [Memory summarization/compression]    (v2)

[Explicit memory editing API] — standalone CRUD, no dependencies
[Bulk memory export]          — standalone filtered dump, no dependencies
```

**Critical path for v1:**
```
Schema → Embedding Pipeline → Fact Extraction → Deduplication check →
Confidence Scoring → Hybrid Retrieval → Personalized Response
```

---

## Roadmap Implications

1. **Phase 1 must add `confidence` and `last_reinforced_at` to `memory_entries` schema** — every quality feature depends on these two fields; retrofitting later is a migration headache
2. **Validate node carries the most product weight** — deduplication check + contradiction arbitration both belong here; this is where data quality is made or lost
3. **Hybrid retrieval (already designed) is the right call** — `people` table + name-mention lookup solves the single biggest failure mode of pure vector retrieval
4. **Explicit memory editing API should be in v1 scope** — low complexity (CRUD on `memory_entries`), disproportionately high trust signal
5. **Memory decay and re-ranking are safe to defer to v2** — improve quality at scale, but system is fully functional without them

---

## Open Questions

- **Conflict resolution UX**: When Validate node flags a CONFLICT, where does it go? Silently prefer newer? Store both? Surface to user? Needs product decision before Validate node is implemented.
- **`fact_type` taxonomy**: What are the exact classes? (preference / relationship / event / belief / goal / habit is a reasonable starting point)
- **Confidence initial value**: What score should a newly extracted fact start at? What should a contradicting replacement start at vs. a reinforcing duplicate?
- **Deduplication threshold**: 0.90 cosine similarity is a reasonable starting point but needs empirical tuning

---
*Research completed: 2026-04-15*
