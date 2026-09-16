# Xiaozhi Navigation Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open Xiaozhi at the latest message when appropriate, preserve the user's reading position across linked-object navigation, keep in-flight turns across tab changes, and recover safely from model JSON protocol mistakes.

**Architecture:** Keep the existing module-level turn job and atomic SQLite commit. Add a layout-driven one-shot scroll intent plus near-end following in the screen, then make provider parsing resilient by accepting natural completion wording and repairing malformed JSON once with a compact response-only request. Persist exact bounded diagnostic details and repair metadata without storing prompts, keys, or response bodies.

**Tech Stack:** Expo SDK 57, React Native 0.86 FlatList, TypeScript, Expo Router, WinterCG fetch streams, Expo SQLite, Node test scripts.

---

### Task 1: Add failing scrolling and protocol tests

**Files:**
- Modify: `scripts/test-assistant-ui.ts`
- Modify: `scripts/test-assistant-protocol.ts`
- Modify: `scripts/test-assistant-turn.cjs`

1. Test the pure near-end calculation used to decide whether streaming content follows the bottom.
2. Change the former execution-claim rejection case to require successful parsing plus a protocol warning.
3. Add a provider fixture whose first JSON response is malformed and whose second compact repair response is valid; assert exactly one repair and no full conversation replay in the repair prompt.
4. Add failure-log expectations for exact error detail and repair metadata.
5. Run the focused tests and confirm they fail before implementation.

### Task 2: Make bottom positioning layout-driven

**Files:**
- Modify: `src/assistant/ui-state.ts`
- Modify: `app/(tabs)/assistant.tsx`

1. Add a pure `shouldFollowAssistantEnd` helper using content height, viewport height, offset, and a small threshold.
2. Keep a one-shot pending scroll ref when Xiaozhi gains focus or the user sends a message.
3. Execute the pending scroll from `onContentSizeChange`, after the final message and receipt height is known; keep an immediate requestAnimationFrame fallback for already-laid-out content.
4. Follow streaming growth only while the user remains near the bottom; loading older messages and reading history must not jump down.
5. Mark navigation from a message receipt as position-preserving. On return, refresh messages without creating a bottom-scroll intent or re-enabling near-end following.
6. Run UI tests.

### Task 3: Repair malformed model JSON once

**Files:**
- Modify: `src/assistant/protocol.ts`
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/prompt.ts`

1. Stop treating natural phrases such as “记下了” as fatal protocol errors; report them as non-fatal warnings.
2. Prefix candidate-operation parse failures with their array index so diagnostics identify the exact candidate.
3. On an `AssistantProtocolError`, call the same configured model once with only the invalid response, the parse reason, reference time/timezone, and compact schema instructions.
4. Parse the repaired response through the same strict parser; never repair twice.
5. Aggregate token usage and expose repair count/status plus protocol warnings in provider metadata.
6. Run protocol and turn tests.

### Task 4: Persist exact bounded failure diagnostics

**Files:**
- Modify: `src/assistant/action-schema.ts`
- Modify: `src/db.ts`
- Modify: `src/assistant/decision-log.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-assistant-turn.cjs`

1. Add additive columns for `error_detail`, `repair_count`, `repair_status`, and protocol warnings; migrate existing Dev databases with guarded `ALTER TABLE` calls.
2. Reset all diagnostic fields when retrying the same request ID.
3. Store provider repair metadata on success and the bounded error message on failure.
4. Print a redacted one-line Dev summary for both success and failure.
5. Verify that logs never contain the key, authorization header, full prompt, or raw model body.
6. Run database and turn tests.

### Task 5: Verify, document, and deliver

**Files:**
- Modify: `docs/plans/2026-09-15-xiaozhi-navigation-resilience-design.md`
- Modify: `docs/knowledge/xiaozhi-streaming-date-audit.md`
- Modify: `docs/knowledge/INDEX.md`

1. Run focused tests, `npm test`, and `npm run ci` with Node 24.
2. Mark the design implemented but awaiting Dev acceptance; record the root cause, migration, verification, and rollback commit.
3. Commit and push to the existing `codex/xiaozhi-todos-events` branch and PR #19.
4. Keep the existing Expo tunnel and Reload the connected Dev App; do not start a second Metro endpoint.
