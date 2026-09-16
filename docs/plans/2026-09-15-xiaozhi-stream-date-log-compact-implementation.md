# Xiaozhi Streaming, Model Dates, Decision Logs, and Compact Cards Implementation Plan

**Status:** Implementation complete; automated checks passed; awaiting Dev device acceptance.

**Goal:** Stream Xiaozhi's natural reply, let the model decide and resolve todo dates, persist a diagnostic decision trail, and compact event/action cards.

**Architecture:** Keep one OpenAI-compatible model call per turn and stream its JSON content over Expo 57 `expo/fetch`. Incrementally expose only the `reply` JSON string to the UI; parse and validate the complete structured response before the existing exclusive SQLite commit. Replace local Chinese date interpretation in assistant operations with model-returned local calendar fields, and store a bounded local audit row for each decision stage.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Expo Router, `expo/fetch`, `expo-sqlite`, Node/Bun test scripts.

---

### Task 1: Extend the model operation protocol for resolved dates

**Files:**
- Modify: `src/assistant/action-types.ts`
- Modify: `src/assistant/protocol.ts`
- Modify: `src/assistant/prompt.ts`
- Modify: `scripts/test-assistant-protocol.ts`

1. Add failing protocol cases for `date_status`, `date_text`, `due_date`, `due_time`, and `time_precision`.
2. Require a date decision for newly created todos; keep date changes optional for existing todos.
3. Enforce field consistency: resolved dates require a real calendar date, absent/ambiguous dates cannot contain a resolved date.
4. Update the prompt to distinguish event-state judgment from concrete-next-action judgment and to provide exact reference time/timezone.
5. Run `npm run test:assistant-protocol`.

### Task 2: Project model dates into existing todo storage

**Files:**
- Create: `src/assistant/model-date.ts`
- Modify: `src/assistant/action-validator.ts`
- Modify: `src/assistant/action-store.ts`
- Modify: `src/db.ts`
- Modify: `scripts/test-assistant-actions.ts`
- Modify: `scripts/test-assistant-turn.cjs`

1. Add failing tests for date-only, explicit time, cross-month, cross-year, leap-day, absent, ambiguous, and invalid calendar output.
2. Convert a validated model local date to the existing `due_at` value without reading `date_text`.
3. Persist `time_precision` from the validated model output for assistant-created and assistant-updated todos.
4. Keep model judgment authoritative: never synthesize a todo and never parse the user's language locally.
5. Run assistant action and turn tests.

### Task 3: Stream the natural reply safely

**Files:**
- Create: `src/assistant/streaming-json.ts`
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `src/components/AssistantMessageBubble.tsx`
- Modify: `scripts/test-assistant-protocol.ts`
- Modify: `scripts/test-assistant-turn.cjs`
- Modify: `scripts/test-assistant-ui.ts`

1. Add SSE fixtures whose JSON content and escaped Chinese text are split across arbitrary byte boundaries.
2. Request `stream: true` using Expo 57 streaming fetch and collect OpenAI-compatible `data:` events.
3. Incrementally decode the first `reply` JSON field and publish text updates without exposing incomplete operations.
4. Show a temporary assistant bubble while the user message remains `sending`; remove it on failure or replace it with the saved assistant message after commit.
5. Preserve the current disabled/cleared composer behavior until validation and commit finish.
6. Run provider, turn, and UI tests.

### Task 4: Persist a bounded assistant decision log

**Files:**
- Modify: `src/assistant/action-schema.ts`
- Create: `src/assistant/decision-log.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-assistant-turn.cjs`

1. Add a local `assistant_decision_logs` table keyed by request ID.
2. Record prompt version, model, reference time/timezone, selected context IDs, proposed operations, validation results, provider metadata/timing, committed operation IDs, and terminal status.
3. Redact secrets by construction: do not store keys, authorization headers, full prompts, or duplicate conversation bodies.
4. Keep only the newest 500 rows and emit a one-line development summary.
5. Make log-write failures non-blocking for the user transaction.
6. Run database and turn tests.

### Task 5: Compact event and action receipt cards

**Files:**
- Modify: `src/components/AssistantEventCard.tsx`
- Modify: `src/components/AssistantActionReceipt.tsx`
- Modify: `src/assistant/ui-state.ts`
- Modify: `scripts/test-assistant-ui.ts`

1. Reduce event-card padding/gaps and place update time in the title row so the card reads as two compact lines.
2. Group receipt operations by destination object, combining event update/progress and relation details instead of giving each low-level operation a full-height row.
3. Preserve 44-point touch targets for navigable/undo controls while reducing visual padding.
4. Add pure grouping-state tests and run UI tests.

### Task 6: Full verification and PR delivery

**Files:**
- Modify: `docs/plans/2026-09-15-xiaozhi-model-date-audit-design.md`
- Modify: `docs/knowledge/INDEX.md`
- Create: `docs/knowledge/xiaozhi-streaming-date-audit.md`

1. Update the accepted design status and document decisions, failure modes, verification, and rollback point.
2. Run focused tests, `npm test`, and `npm run ci` using a Node version compatible with Expo SDK 57.
3. Commit in reviewable units on `codex/xiaozhi-todos-events` and push to PR #19.
4. Verify GitHub `CI / validate`.
5. Keep the existing Expo tunnel transport; Reload the connected Dev build for device acceptance because these are JavaScript/schema/style changes without native dependencies.
