---
phase: 03-chat-path
fixed_at: 2026-04-16T00:00:00Z
review_path: .planning/phases/03-chat-path/03-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-04-16T00:00:00Z
**Source review:** .planning/phases/03-chat-path/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Current user message duplicated in LLM prompt

**Files modified:** `src/chat/chat.gateway.ts`
**Commit:** a3c29fc
**Applied fix:** Moved the `addMessage` call for the user message to after the `Promise.all` that fetches history and retrieval context. This ensures `getRecentMessages` runs against the table before the current turn is inserted, so the current message can never appear both in the history slice and as the final `HumanMessage`. Also updated the extraction enqueue call to use the validated `text` variable rather than `payload.message`.

### WR-02: `ChatSendPayload.message` is not validated

**Files modified:** `src/chat/chat.gateway.ts`
**Commit:** a3c29fc
**Applied fix:** Added a validation guard at the top of `handleChatSend` (before any async work) that trims the message, rejects empty strings and strings longer than 4000 characters with a `chat:error` emission, and stores the trimmed value as `text`. All downstream calls (`retrieve`, `addMessage`, `buildMessages`, extraction enqueue) now use `text` instead of `payload.message`.

### WR-03: Empty assistant message persisted when stream yields no tokens

**Files modified:** `src/chat/chat.gateway.ts`
**Commit:** a3c29fc
**Applied fix:** Wrapped the assistant `addMessage` persistence call in `if (fullResponse.length > 0)` so that an empty string is never written to `conversation_messages` when the LLM stream yields no tokens.

---

_Fixed: 2026-04-16T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
