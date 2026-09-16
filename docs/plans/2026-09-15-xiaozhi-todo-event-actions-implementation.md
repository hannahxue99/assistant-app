# Xiaozhi Todo and Event Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Xiaozhi create and update durable todos and events in one model turn, show a truthful merged receipt, and surface the results on Home and Event Detail.

**Architecture:** Extend the current structured assistant turn with bounded proposed operations. Resolve candidates and validate every mutation locally, then atomically save the assistant reply, actual operations, object relations, and event changes in SQLite. Keep existing `entries(kind='task')` as the todo source of truth and add first-class event tables.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TypeScript, `expo-sqlite`, existing OpenAI-compatible provider, Node/tsx test scripts.

---

### Task 1: Add operation and event types with schema tests

**Files:**
- Create: `src/assistant/action-types.ts`
- Create: `src/assistant/action-schema.ts`
- Create: `scripts/test-assistant-actions-database.cjs`
- Modify: `src/assistant/schema.ts`
- Modify: `src/db.ts`
- Modify: `package.json`

**Step 1: Write the failing schema test**

Create an in-memory SQLite test that initializes the existing assistant schema plus the new action schema and asserts the presence and constraints of `assistant_events`, `assistant_event_aliases`, `assistant_event_updates`, `assistant_object_relations`, and `assistant_operations`. Verify duplicate `(request_id, operation_key)` inserts fail.

**Step 2: Run the test to verify it fails**

Run: `npm run test:assistant-actions-db`

Expected: FAIL because the action schema and npm script do not exist.

**Step 3: Define types and minimal schema**

Define stable types for `AssistantEvent`, `AssistantEventUpdate`, `AssistantOperation`, object references, operation status, and supported operation proposals. Add only the indexes needed for event recency, aliases, relations, source messages, and request receipts.

**Step 4: Register schema initialization**

Append `assistantActionSchema` to the same versioned database initialization path as `assistantSchema`. Do not delete or rewrite old tables.

**Step 5: Run tests**

Run: `npm run test:assistant-actions-db && npm run typecheck`

Expected: PASS.

**Step 6: Commit**

```bash
/usr/bin/git add src/assistant/action-types.ts src/assistant/action-schema.ts src/assistant/schema.ts src/db.ts scripts/test-assistant-actions-database.cjs package.json
/usr/bin/git commit -m "feat: add assistant event and operation schema"
```

### Task 2: Implement event storage and legacy topic migration

**Files:**
- Create: `src/assistant/event-store.ts`
- Create: `src/assistant/event-migration.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `app/_layout.tsx`

**Step 1: Add failing repository tests**

Cover create/read/list/update current state, append-only progress, duplicate progress keys, rename with alias retention, pin ordering, related todo queries, optimistic revision checks, and a missing event.

Add migration cases for two old topics, latest-summary current state, one initial visible update per topic, all source relations, retained old rows, and repeated migration producing identical counts.

**Step 2: Run the test to verify it fails**

Run: `npm run test:assistant-actions-db`

Expected: FAIL on missing store and migration functions.

**Step 3: Implement transaction-aware store primitives**

Repository functions must accept an optional transaction connection so the orchestrator can compose them in one exclusive transaction. Public read functions use the existing connection helper.

**Step 4: Implement a small idempotent migration batch**

Use a deterministic legacy key derived from the exact topic. Preserve `entries.topic` and `topic_preferences`; write a migration marker only after each topic succeeds.

**Step 5: Run tests and commit**

Run: `npm run test:assistant-actions-db && npm run test:assistant-db`

Expected: PASS.

```bash
/usr/bin/git add src/assistant/event-store.ts src/assistant/event-migration.ts scripts/test-assistant-actions-database.cjs app/_layout.tsx
/usr/bin/git commit -m "feat: persist assistant events and migrate topics"
```

### Task 3: Extend and strictly parse the model operation protocol

**Files:**
- Modify: `src/assistant/protocol.ts`
- Modify: `src/assistant/prompt.ts`
- Modify: `src/assistant/types.ts`
- Modify: `scripts/test-assistant-protocol.ts`

**Step 1: Add failing protocol cases**

Test empty operations, a new event referenced by a same-turn todo, an existing event update by candidate ID, completion of a candidate todo, duplicate operation keys, unknown operations, arbitrary IDs, more than six operations, oversized fields, malformed local references, and fenced JSON.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-protocol`

Expected: FAIL because `operations` is ignored or unsupported.

**Step 3: Implement bounded parsing**

Parse into a discriminated union and normalize text lengths. Reject the whole protocol for structural corruption; retain an empty array when `operations` is absent for backward-compatible provider fixtures.

**Step 4: Update prompt contract**

Provide candidate event and todo IDs, require local refs for new objects, require date text instead of timestamps, forbid execution claims in `reply`, and document the conservative event gate.

**Step 5: Run tests and commit**

Run: `npm run test:assistant-protocol && npm run typecheck`

Expected: PASS.

```bash
/usr/bin/git add src/assistant/protocol.ts src/assistant/prompt.ts src/assistant/types.ts scripts/test-assistant-protocol.ts
/usr/bin/git commit -m "feat: add bounded todo and event operation protocol"
```

### Task 4: Select candidates and validate event admission

**Files:**
- Create: `src/assistant/action-context.ts`
- Create: `src/assistant/action-validator.ts`
- Create: `scripts/test-assistant-actions.ts`
- Modify: `src/assistant/context.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `package.json`

**Step 1: Write failing pure-function tests**

Cover one-off todo only, explicit continuous language, repeated related evidence, existing event continuation, event launch context, one strong candidate, two ambiguous candidates, ID outside the candidate set, duplicate state/update text, no-date todo, follow-up date applied to the same todo, and local-reference resolution.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-actions`

Expected: FAIL because candidate and validation modules do not exist.

**Step 3: Implement bounded candidate retrieval**

Return at most five active events and five open todos. Rank title, aliases, state, linked todo text, recency, current segment binding, and explicit launch context. Include stable IDs only for selected candidates.

**Step 4: Implement deterministic validation**

Use current-message evidence, repeated relevant evidence, candidate sets, exact local refs, and `parseChineseTime(referenceAt)` for dates. Return validated operations plus explicit rejection reasons for tests and local diagnostics; do not log user content.

**Step 5: Run tests and commit**

Run: `npm run test:assistant-actions && npm run test:assistant-context && npm run typecheck`

Expected: PASS.

```bash
/usr/bin/git add src/assistant/action-context.ts src/assistant/action-validator.ts src/assistant/context.ts src/assistant/orchestrator.ts scripts/test-assistant-actions.ts package.json
/usr/bin/git commit -m "feat: validate assistant object actions locally"
```

### Task 5: Apply actions and save truthful receipts atomically

**Files:**
- Create: `src/assistant/action-store.ts`
- Modify: `src/assistant/store.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `scripts/test-assistant-turn.cjs`
- Modify: `scripts/test-assistant-actions-database.cjs`

**Step 1: Add failing integration tests**

Test one request creating a dated todo only; one request creating an event and initial update; one request updating an event, appending progress, creating and linking a todo; retry idempotency; invalid operations omitted from receipts; transaction rollback; and no assistant success message after a failed commit.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-turn && npm run test:assistant-actions-db`

Expected: FAIL on missing action application and receipt persistence.

**Step 3: Add transaction-aware entry mutations**

Extract internal helpers for creating, updating, completing, and deleting assistant-owned task entries using the existing entries schema and calendar queue triggers. Preserve public database behavior.

**Step 4: Apply operations in dependency order**

Resolve new event/todo refs, write event state and progress, create relations, store before/after snapshots, then save the assistant message and mark the request succeeded inside one exclusive transaction.

**Step 5: Expose receipt reads**

List committed operations by request ID in stable order. Derive labels from actual stored objects, never directly from model receipt copy.

**Step 6: Run tests and commit**

Run: `npm run test:assistant-turn && npm run test:assistant-actions-db && npm run typecheck`

Expected: PASS.

```bash
/usr/bin/git add src/assistant/action-store.ts src/assistant/store.ts src/assistant/orchestrator.ts scripts/test-assistant-turn.cjs scripts/test-assistant-actions-database.cjs
/usr/bin/git commit -m "feat: commit assistant actions and receipts atomically"
```

### Task 6: Implement guarded undo

**Files:**
- Create: `src/assistant/action-undo.ts`
- Modify: `src/assistant/action-store.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`

**Step 1: Add failing undo tests**

Cover undo of newly created todo/event, restoration of event state, reversion of appended progress and relations, repeated undo idempotency, calendar cleanup queue, and refusal when todo revision or event revision changed after the original turn.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-actions-db`

Expected: FAIL on missing undo behavior.

**Step 3: Implement one compensating transaction**

Undo operations in reverse dependency order. Compare current revisions and after snapshots before writing. Return `undone`, `already-undone`, or `conflict` for UI handling.

**Step 4: Run tests and commit**

Run: `npm run test:assistant-actions-db && npm run test:calendar`

Expected: PASS.

```bash
/usr/bin/git add src/assistant/action-undo.ts src/assistant/action-store.ts scripts/test-assistant-actions-database.cjs
/usr/bin/git commit -m "feat: add guarded assistant turn undo"
```

### Task 7: Render merged receipts in Xiaozhi

**Files:**
- Create: `src/components/AssistantActionReceipt.tsx`
- Modify: `src/components/AssistantMessageBubble.tsx`
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `src/assistant/types.ts`
- Modify: `scripts/test-assistant-ui.ts`

**Step 1: Add failing UI state tests**

Test no receipt for zero operations, stable operation ordering, navigation target by object type, undo enabled only for committed unreverted operations, undo conflict copy, and one combined receipt for multiple operations.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-ui`

Expected: FAIL on missing receipt state helpers.

**Step 3: Add receipt data to message loading**

Batch-load operations for visible assistant request IDs to avoid one query per bubble. Merge them into page state without changing message identity.

**Step 4: Build the receipt component**

Use the confirmed warm card treatment, concise action rows, 44×44 targets, object navigation, disabled/processing/error undo states, and no second chat message.

**Step 5: Run tests and commit**

Run: `npm run test:assistant-ui && npm run typecheck`

Expected: PASS.

```bash
/usr/bin/git add src/components/AssistantActionReceipt.tsx src/components/AssistantMessageBubble.tsx 'app/(tabs)/assistant.tsx' src/assistant/types.ts scripts/test-assistant-ui.ts
/usr/bin/git commit -m "feat: show merged Xiaozhi action receipts"
```

### Task 8: Surface events on Home and add Event Detail

**Files:**
- Create: `src/components/AssistantEventCard.tsx`
- Create: `app/event/[id].tsx`
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/assistant/event-store.ts`
- Modify: `scripts/test-assistant-actions.ts`

**Step 1: Add failing projection tests**

Test pinned-first ordering, recent event ordering, homepage view fields, related timed and hidden todos, progress chronology, empty event state, and missing event behavior.

**Step 2: Run to verify failure**

Run: `npm run test:assistant-actions`

Expected: FAIL on missing projections.

**Step 3: Add the Home event section**

Load it independently from week tasks so event failure cannot blank the page. Hide migrated topic cards from the legacy aggregate area to prevent duplicate event presentation; retain original records during transition.

**Step 4: Build Event Detail**

Render stable title, current state, related todos, append-only progress, pin/rename states, loading/error/empty states, and the contextual Xiaozhi entry action.

**Step 5: Verify navigation and commit**

Run: `npm run test:assistant-actions && npm run typecheck`

Expected: PASS.

```bash
/usr/bin/git add src/components/AssistantEventCard.tsx 'app/event/[id].tsx' 'app/(tabs)/index.tsx' src/assistant/event-store.ts scripts/test-assistant-actions.ts
/usr/bin/git commit -m "feat: add home events and event detail"
```

### Task 9: Complete integration, migration, and delivery checks

**Files:**
- Modify: `docs/plans/2026-09-15-xiaozhi-todo-event-actions-design.md`
- Modify: `docs/quality/xiaozhi-multiturn-fixtures.md`
- Modify: `README.md` only if device verification steps changed

**Step 1: Add end-to-end fixed fixtures**

Cover: one-off todo, hidden todo plus date follow-up, new event, existing event continuation, ambiguous similar events, combined event/todo turn, completion, retry, undo, app restart, and legacy topic migration.

**Step 2: Run targeted suites**

Run: `npm run test:assistant-actions-db && npm run test:assistant-actions && npm run test:assistant-protocol && npm run test:assistant-turn && npm run test:assistant-ui`

Expected: PASS.

**Step 3: Run the required aggregate check**

Run: `npm run ci`

Expected: all TypeScript and aggregated tests PASS.

**Step 4: Review the branch**

Confirm no API key, full prompt content, test fixture, internal preview, hidden debug route, or user-owned untracked design file enters the diff. Verify migrations are additive and old data remains intact.

**Step 5: Push and create the stacked PR**

Push `codex/xiaozhi-todos-events` and create a PR targeting `codex/xiaozhi-conversation-v03` while PR #17 is open. After #17 merges, retarget to `main` and wait for required `CI / validate`.

**Step 6: Device acceptance**

Because this phase changes JavaScript and SQLite schema but no native dependency, use the existing Dev build with Metro Reload. Verify the fixed cases on the phone, then capture accepted knowledge, release metadata, rollback commit, and only then merge.
