# Event Delta Decision Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make one Xiaozhi model decision coherently update an existing event's current state, append meaningful progress, and create/update/complete linked todos.

**Architecture:** Add an `event_deltas` protocol beside the existing generic operation protocol, then compile each validated semantic delta into the existing atomic operations. Enrich event candidates with linked todo identity and state, validate evidence and cross-object consistency locally, and commit compiled operations through the existing single SQLite transaction and receipt pipeline.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, expo-sqlite, structured chat-completion JSON, tsx and Node SQLite integration tests.

**Protocol reliability:** `event_delta.key` is local idempotency metadata generated from array order. The model only returns semantic fields, so a missing or duplicated internal key cannot invalidate an otherwise usable reply.

---

### Task 1: Define and parse the event-delta protocol

**Files:**
- Create: `src/assistant/event-delta-types.ts`
- Modify: `src/assistant/protocol.ts`
- Modify: `scripts/test-assistant-protocol.ts`

**Step 1: Write failing protocol tests**

Add a valid existing-event delta containing evidence, a full replacement state, one progress item, and a dated todo creation. Add invalid cases for missing evidence, unsupported target actions, `keep` with a value, `replace` without a value, oversized arrays, invalid todo references, and cancel mutations.

**Step 2: Run the focused test and verify failure**

Run: `npm run test:assistant-protocol`
Expected: FAIL because `eventDeltas` is not part of `AssistantTurnOutput`.

**Step 3: Implement strict parsing**

Parse at most two deltas. Existing targets require an allowed identifier; new targets require a local `event_N` ref and title; `none`/`clarify` accept no mutations. Parse `state`, up to two progress items, and up to two todo mutations using the same date protocol as generic todo operations. Continue accepting old model responses with missing `event_deltas` as an empty array.

**Step 4: Run the focused test**

Run: `npm run test:assistant-protocol`
Expected: PASS.

### Task 2: Enrich event candidates with linked todo facts

**Files:**
- Modify: `src/assistant/action-types.ts`
- Modify: `src/assistant/action-context.ts`
- Modify: `src/assistant/context.ts`
- Modify: `scripts/test-assistant-actions.ts`
- Modify: `scripts/test-assistant-context.ts`

**Step 1: Add failing context tests**

Assert that an explicit event candidate carries linked todo IDs, text, due dates, completion state, and revisions, and that the rendered context clearly separates active and recently completed linked todos.

**Step 2: Run the focused tests and verify failure**

Run: `npm run test:assistant-actions`
Run: `npm run test:assistant-context`
Expected: FAIL because candidates only contain linked todo text.

**Step 3: Load and render linked todo facts**

Join active `belongs_to` relations to task entries, retain active linked todos plus a bounded recent-completed set, and attach typed todo facts to every selected event candidate. Keep `linkedTodoTexts` as a compatibility projection for ranking. Render compact IDs, dates, states, and revision timestamps into the model context.

**Step 4: Run the focused tests**

Run both focused commands.
Expected: PASS without exceeding the existing 6,000-token context ceiling.

### Task 3: Validate and compile coherent deltas

**Files:**
- Create: `src/assistant/event-delta.ts`
- Create: `scripts/test-assistant-event-delta.ts`
- Modify: `package.json`

**Step 1: Write failing compiler tests**

Cover: new plan -> state/update/progress/create/link; changed date -> update/link without duplicate create; completion -> complete/link; fact-only progress; external possibility -> no mutations; evidence outside the current message; duplicate progress; ambiguous event; todo outside candidates; no progress accompanying state or todo changes; deterministic operation keys.

**Step 2: Register and run the failing test**

Add `test:assistant-event-delta` to the aggregate `npm test` command.

Run: `npm run test:assistant-event-delta`
Expected: FAIL because the compiler does not exist.

**Step 3: Implement semantic validation and compilation**

Normalize current-message evidence, validate targets and consistency, and compile accepted deltas into existing `AssistantOperationProposal` values. Automatically append `link_todo_event` for each todo mutation. Run the existing action validator over compiled and generic operations; if any operation belonging to a delta is rejected, drop the entire delta group and record a structured rejection.

**Step 4: Run compiler and existing action tests**

Run: `npm run test:assistant-event-delta`
Run: `npm run test:assistant-actions`
Expected: PASS.

### Task 4: Update the single-call prompt and orchestration

**Files:**
- Modify: `src/assistant/prompt.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/decision-log.ts`
- Modify: `src/assistant/action-schema.ts`
- Modify: `src/db.ts`
- Modify: `scripts/test-assistant-quality.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`

**Step 1: Add failing prompt, logging, and integration assertions**

Assert that the prompt requires one event-level delta, full after-state preservation, exact current-message evidence, automatic todo linking, and the accepted positive/negative examples. Assert that decision logs preserve raw deltas and compiled validation, including existing-device column migration.

**Step 2: Run focused tests and verify failure**

Run: `npm run test:assistant-quality`
Run: `npm run test:assistant-actions-db`
Expected: FAIL before the prompt, log column, and orchestration are updated.

**Step 3: Wire the decision pipeline**

Update the prompt version and JSON guide. After the provider returns, compile deltas plus any unrelated generic operations, validate atomically by delta group, log raw deltas and compiled operations, and pass only accepted operations to the existing transactional turn completion. Add `proposed_event_deltas_json` to new schemas and incrementally migrate existing databases.

**Step 4: Run focused tests**

Run both focused commands plus `npm run test:assistant-turn`.
Expected: PASS; existing generic actions remain backward-compatible.

### Task 5: Verify device-ready behavior and deliver

**Files:**
- Modify: `docs/plans/2026-09-15-event-delta-decision-design.md`

**Step 1: Run the aggregate gate**

Run: `npm run ci`
Expected: TypeScript and every registered test pass.

**Step 2: Review safety properties**

Verify one provider request per attempt, no deterministic keyword-based semantic classification, no native dependency/config changes, atomic grouped writes, stable retry keys, bounded context, and no accidental todo cancellation mapping.

**Step 3: Commit and push to the existing PR**

Commit implementation and test changes to `codex/xiaozhi-todos-events`, then push PR #19.

**Step 4: Reload the existing Dev session**

Send `r` to Metro session `33273` and confirm the iOS bundle completes. Device acceptance should exercise: new plan, changed date, completed todo, external possibility, and ambiguous target.
