# Xiaozhi Grounded Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Xiaozhi read real event/todo state on demand, execute only locally verified plans, and produce the final reply from the actual execution receipt.

**Architecture:** Add a bounded read-tool loop around the existing DeepSeek planning request, preserve the structured action protocol, replace semantic candidate re-judgment with a per-turn readable-ID capability set, commit through the existing exclusive SQLite transaction, then make a separate grounded narration request from the execution receipt with a deterministic local fallback.

**Tech Stack:** Expo 57, React Native 0.86, TypeScript 6, expo-sqlite, DeepSeek OpenAI-compatible streaming chat completions, Node/tsx regression scripts.

---

### Task 1: Define grounded tool and execution contracts

**Files:**
- Create: `src/assistant/data-tools.ts`
- Create: `src/assistant/execution-result.ts`
- Test: `scripts/test-assistant-data-tools.ts`
- Modify: `package.json`

1. Write failing contract tests for tool argument parsing, bounded search results, readable ID collection, execution receipt summaries, and failure fallback copy.
2. Add read-tool definitions and typed results for event/todo search/get.
3. Add the execution result type and deterministic receipt-to-reply fallback.
4. Register the new test in `npm test` and run it.

### Task 2: Read live event and todo state

**Files:**
- Modify: `src/assistant/data-tools.ts`
- Test: `scripts/test-assistant-data-tools-database.cjs`
- Modify: `package.json`

1. Write a database regression test with events, updates, todos, relations, and revisions.
2. Implement parameterized SQLite search/get queries with compact limits.
3. Return event state, recent updates, linked todos, todo dates/status, revisions, and relations.
4. Verify unknown IDs and deleted objects return explicit `not_found` results.

### Task 3: Add a bounded streamed read-tool loop

**Files:**
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/prompt.ts`
- Test: `scripts/test-assistant-turn.cjs`
- Test: `scripts/test-assistant-protocol.ts`

1. Add failing SSE fixtures for fragmented `tool_calls`, multi-round messages, reasoning content, tool limit, and cancellation.
2. Parse streamed tool-call deltas and retain assistant `reasoning_content` when sending the next DeepSeek request.
3. Execute only the four read tools, append tool results, and cap the loop at four tool calls/two read rounds.
4. After tools finish, request the existing strict JSON plan; do not stream its provisional reply to the UI.
5. Return read event/todo IDs and aggregated provider diagnostics.

### Task 4: Stop double semantic adjudication

**Files:**
- Modify: `src/assistant/action-types.ts`
- Modify: `src/assistant/action-validator.ts`
- Modify: `src/assistant/event-delta.ts`
- Test: `scripts/test-assistant-actions.ts`
- Test: `scripts/test-assistant-event-delta.ts`

1. Add the exact “十一出行” regression where two candidates score closely but the selected exact ID is readable.
2. Extend action context with per-turn readable IDs and live snapshots from tools.
3. Allow updates to readable IDs without `classifyEventCandidates` veto; preserve create-event admission and all structural/date/delete checks.
4. Validate evidence against the current message plus recent user messages.
5. Keep all-or-nothing behavior inside one event delta.

### Task 5: Execute first, narrate from the receipt

**Files:**
- Modify: `src/assistant/action-store.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/store.ts`
- Test: `scripts/test-assistant-actions-database.cjs`
- Test: `scripts/test-assistant-turn.cjs`

1. Add failing tests proving a rejected plan cannot yield success copy and a committed plan exposes its post-write snapshot.
2. Commit with a deterministic provisional reply and return structured operation receipts/post-state.
3. Request a final natural reply using only the user goal and execution receipt; stream only this reply.
4. Replace the provisional message with the final reply. On narration failure, keep the deterministic local reply and successful data changes.
5. Ensure cancellation before commit writes nothing; after commit it does not misreport rollback.

### Task 6: Expose truthful runtime stages and diagnostics

**Files:**
- Modify: `src/assistant/runtime-state.ts`
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `src/assistant/decision-log.ts`
- Modify: `src/assistant/schema.ts`
- Test: `scripts/test-assistant-ui.ts`
- Test: `scripts/test-assistant-actions-database.cjs`

1. Add tests for `reading`, `planning`, `updating`, `answering`, and `finalizing` labels.
2. Drive stages from the tool loop, validation/commit, and final narration.
3. Add additive diagnostic fields for read IDs and execution outcome; never mark zero-write rejection as committed.
4. Keep the input interrupt behavior unchanged.

### Task 7: Regression, documentation, and PR

**Files:**
- Modify: `docs/quality/xiaozhi-multiturn-fixtures.md`
- Modify: relevant implementation documents if contracts changed

1. Add the release failure transcript as a reusable multi-turn fixture.
2. Run targeted tests after each task, then `npm run ci`.
3. Inspect the diff for secrets, migration safety, and unrelated changes.
4. Commit on `codex/xiaozhi-grounded-tools`, push, open a PR, and report checks plus device-test instructions.

