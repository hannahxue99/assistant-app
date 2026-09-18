# Xiaozhi On-Demand Object Access Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Xiaozhi read event and todo state only when the model needs it, reuse valid working snapshots, and forbid writes against objects that were neither read nor cached.

**Architecture:** The first model request contains conversation, summaries, relevant long-term memory, explicit object IDs, and only previously read valid working snapshots. Event/todo search and detail tools provide live state; exact detail reads populate a segment-scoped in-memory snapshot cache. After planning, local validation builds its allowed object context exclusively from exact reads and valid cached snapshots, then applies revision checks and transactional writes.

**Tech Stack:** Expo 57, React Native, TypeScript, expo-sqlite, DeepSeek-compatible chat completions, Node test scripts.

---

### Task 1: Remove unsolicited event and todo content from the base context

**Files:**
- Modify: `src/assistant/context.ts`
- Modify: `scripts/test-assistant-context.ts`
- Modify: `scripts/test-assistant-quality.ts`

**Step 1: Write failing tests**

- Assert that passing an `actionContext` no longer renders event titles, states, IDs, or linked todo content in `contextBlock`.
- Assert that an event/todo launch context renders only its object type and ID, not label or state.
- Keep reminder launch copy unchanged.

**Step 2: Run tests and verify failure**

Run: `npm run test:assistant-context && npm run test:assistant-quality`

Expected: FAIL because the current renderer includes action candidates and launch labels/states.

**Step 3: Implement minimal context changes**

- Remove action candidate rendering from `renderContextBlock`.
- Render event/todo launch context as an ID pointer only.
- Add a separate renderer input for valid working snapshots; render only snapshots previously read in the active segment.

**Step 4: Run tests and verify pass**

Run: `npm run test:assistant-context && npm run test:assistant-quality`

Expected: PASS.

### Task 2: Distinguish search discovery from exact reads

**Files:**
- Modify: `src/assistant/data-tools.ts`
- Modify: `scripts/test-assistant-data-tools.ts`
- Modify: `src/assistant/prompt.ts`
- Modify: `scripts/test-assistant-protocol.ts`

**Step 1: Write failing tests**

- Assert `search_events` and `search_todos` return candidates but do not add IDs to the exact read set.
- Assert `get_event` and `get_todo` add their exact object and linked objects to the read set.
- Assert the system prompt tells the model to reuse available snapshots and to read missing/stale fields before writes.

**Step 2: Run tests and verify failure**

Run: `npm run test:assistant-data-tools && npm run test:assistant-protocol`

Expected: FAIL because search results currently authorize writes and the prompt does not describe snapshot reuse.

**Step 3: Implement minimal protocol changes**

- Make search tools discovery-only.
- Keep exact detail tools authoritative.
- Add concise tool-use and snapshot-reuse rules to the system prompt.

**Step 4: Run tests and verify pass**

Run: `npm run test:assistant-data-tools && npm run test:assistant-protocol`

Expected: PASS.

### Task 3: Add segment-scoped valid working snapshots

**Files:**
- Create: `src/assistant/working-snapshots.ts`
- Modify: `src/assistant/types.ts`
- Modify: `src/assistant/context.ts`
- Modify: `scripts/test-assistant-turn.cjs`

**Step 1: Write failing tests**

- Assert exact `get_event`/`get_todo` executions become hidden working snapshots for the active segment.
- Assert the next turn reuses a snapshot when its revision is unchanged.
- Assert changed/deleted objects invalidate snapshots.
- Assert snapshots are isolated by segment and are never promoted to long-term memory.

**Step 2: Run tests and verify failure**

Run: `npm run test:assistant-turn`

Expected: FAIL because no working snapshot cache exists.

**Step 3: Implement the snapshot cache**

- Store only exact detail results, keyed by segment and object type/ID.
- Keep the cache process-local and hidden from UI.
- Before reuse, compare stored revisions with SQLite revisions and drop stale/deleted snapshots.
- Expose compact valid snapshots to the context renderer and their IDs to local validation.

**Step 4: Run tests and verify pass**

Run: `npm run test:assistant-turn`

Expected: PASS.

### Task 4: Reorder orchestration around model-led reads

**Files:**
- Modify: `src/assistant/action-context.ts`
- Modify: `src/assistant/action-validator.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-assistant-turn.cjs`

**Step 1: Write failing tests**

- Assert the first provider call receives no ranked/segment-bound event or todo body.
- Assert a model operation against an unread existing ID is rejected.
- Assert an exact tool read or a valid working snapshot authorizes the matching operation.
- Assert explicit navigation gives the model an ID pointer but still requires an exact read before mutation.

**Step 2: Run tests and verify failure**

Run: `npm run test:assistant-actions-db && npm run test:assistant-turn`

Expected: FAIL because orchestration currently builds action candidates before the model call and validation still trusts ranked/segment-bound candidates.

**Step 3: Implement orchestration changes**

- Stop loading ranked action context before `requestAssistantTurn`.
- Wrap tool execution to capture exact reads and avoid duplicate database work within one turn.
- Build validation context after the model response from exact reads plus valid cached snapshots only.
- Keep local revision, evidence, idempotency, and transaction checks unchanged.

**Step 4: Run tests and verify pass**

Run: `npm run test:assistant-actions-db && npm run test:assistant-turn`

Expected: PASS.

### Task 5: Regression coverage, documentation, and delivery

**Files:**
- Modify: `docs/quality/xiaozhi-multiturn-fixtures.md`
- Modify: `docs/plans/2026-09-17-xiaozhi-grounded-actions-design.md`
- Modify existing assistant test scripts as needed; do not add an unregistered test command.

**Step 1: Add regression fixtures**

- Add a neutral-message case proving an unrelated bound legacy event is absent from the first request.
- Add same-object follow-up reuse and stale-revision reread cases.
- Add explicit event/todo entry cases that require `get_*` before update.

**Step 2: Run focused tests**

Run: `npm run test:assistant-context && npm run test:assistant-data-tools && npm run test:assistant-actions-db && npm run test:assistant-turn && npm run test:assistant-protocol`

Expected: PASS.

**Step 3: Run the aggregate gate**

Run: `npm run ci`

Expected: PASS with every new assertion included through existing `npm test` scripts.

**Step 4: Commit and push to the existing PR**

Commit the approved design separately from implementation where practical, push `codex/xiaozhi-grounded-tools`, and verify GitHub `CI / validate` on PR #22.

**Step 5: Device acceptance**

Restart Metro from this worktree if needed, Reload the Dev app, and verify a neutral message succeeds without attaching the old event. Then verify an event-specific follow-up performs a tool read and updates only the selected object.
