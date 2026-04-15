# Phase 3: Chat Path - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 03-chat-path
**Areas discussed:** Message history in context, Memory relevance threshold

---

## Message history in context

| Option | Description | Selected |
|--------|-------------|----------|
| Include prior turns | Load last N messages from conversation_messages and pass as chat history. LLM understands earlier session context. | ✓ |
| Memory-only, stateless per turn | Each chat:send is independent — only hybrid-retrieved memories in context. Simpler, faster, but LLM can't refer back. | |
| Client sends full history | Client passes conversation history in chat:send payload. Zero DB reads, but client owns history state. | |

**User's choice:** Include prior turns (Recommended)
**Notes:** Follow-up — last 10 messages selected as the window size (hard-coded constant, not env var).

---

## Memory relevance threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Filter below 0.7 | Memories with similarity < 0.7 excluded even if in top-5. Keeps system prompt clean. | ✓ |
| No threshold — always inject all top-5 | Every top-5 result injected regardless of similarity. Simpler but risks confusing LLM with low-signal memories. | |

**User's choice:** Filter below 0.7 (Recommended)
**Notes:** Threshold applies to `MemorySearchResult.similarity` (the `1 - cosine_distance` value from `search_user_memories`).

---

## Claude's Discretion

- Conversation creation strategy (per-connection vs. lazy on first send)
- System prompt copy structure around the memory block
- Assistant message persistence timing
- Error event format for stream failures
- UUID validation rejection behavior (silent disconnect vs. error event before close)
