# Xiaozhi Todo and Event Deletion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Xiaozhi delete todos and events safely from either voice or text while preserving chat history, linked-object consistency, undo, calendar compensation, and clear event/todo visibility rules; also ship the confirmed divider and eye-animation polish.

**Architecture:** Add `delete_todo` and `delete_event` to the existing model-operation protocol. The model resolves user intent and candidates, while deterministic validation limits it to current context. The action store executes deletion atomically: todos are hard-deleted with full snapshots, events are soft-deleted by setting `status=closed`, and optional event cascades delete every linked todo. Operation snapshots drive receipts and conflict-aware undo. Closed events are excluded from user-visible and model-visible reads.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, Expo SQLite, Node test scripts, existing assistant JSON protocol and transaction/undo framework.

---

### Task 1: Lock protocol and validation behavior with tests

**Files:**
- Modify: `scripts/test-assistant-protocol.ts`
- Modify: `scripts/test-assistant-actions.ts`
- Modify: `src/assistant/action-types.ts`
- Modify: `src/assistant/protocol.ts`
- Modify: `src/assistant/action-validator.ts`
- Modify: `src/assistant/action-schema.ts`

**Step 1: Write failing protocol tests**

Cover `delete_todo`, `delete_event` with `keep` and `delete`, invalid policy, and missing policy.

**Step 2: Run focused tests and confirm failure**

Run: `npm run test:assistant-protocol && npm run test:assistant-actions`

**Step 3: Add operation types and parsers**

Extend proposals and operation schema. `delete_event` requires an explicit linked-todo policy at commit time; when the user did not decide, the model asks in ordinary reply text and emits no operation.

**Step 4: Add deterministic candidate validation**

Only candidate todo/event IDs from current action context are allowed. Validate both deletion operation types like their update counterparts.

**Step 5: Re-run focused tests**

Expected: PASS.

### Task 2: Implement atomic deletion and rollback-safe snapshots

**Files:**
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `src/db.ts`
- Modify: `src/assistant/event-store.ts`
- Modify: `src/assistant/action-store.ts`

**Step 1: Write failing database tests**

Cover todo deletion, relationship disappearance, calendar tombstone, event keep-todos deletion, event cascade across completed and incomplete todos, and a revision conflict that rolls back the entire transaction.

**Step 2: Run database test and confirm failure**

Run: `npm run test:assistant-actions-database`

**Step 3: Add snapshot/restore primitives**

Add a todo restore helper that reinserts the exact stored entry and relationship snapshot. Add optimistic event close using revision checks.

**Step 4: Apply delete operations atomically**

For `delete_todo`, snapshot the todo and all live relations, then delete it. For `delete_event`, fetch all live linked todos at commit time, verify revisions, close the event, and delete linked todos only when policy is `delete`. Throw on any conflict so the enclosing exclusive transaction rolls back everything.

**Step 5: Re-run database test**

Expected: PASS.

### Task 3: Add undo for both deletion paths

**Files:**
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `src/assistant/action-undo.ts`

**Step 1: Add failing undo tests**

Verify undo restores a deleted todo and its event relation. Verify undo restores a closed event and every cascaded todo/relation. Verify conflicting current state blocks undo.

**Step 2: Implement delete-aware undo checks**

For todo deletion, require the todo to still be absent. For event deletion, require the event to remain at the recorded closed revision and cascaded todos to remain absent.

**Step 3: Restore snapshots in one transaction**

Reinsert todos, reactivate relations, and restore the event snapshot before marking operations undone.

**Step 4: Re-run database test**

Expected: PASS.

### Task 4: Teach the model the confirmation rule and hide closed events

**Files:**
- Modify: `scripts/test-assistant-context.ts`
- Modify: `scripts/test-assistant-turn.cjs`
- Modify: `src/assistant/action-context.ts`
- Modify: `src/assistant/context.ts`
- Modify: `src/assistant/prompt.ts`
- Modify: `src/assistant/event-store.ts`
- Inspect/modify: unified search and event-detail reads that expose events

**Step 1: Add context and prompt assertions**

Expose accurate linked-todo totals, including completed todos, so Xiaozhi can ask whether to delete all linked todos. Assert prompt rules: multiple matches ask; linked event deletion without a policy asks; explicit keep/delete skips the question; no answer commits nothing.

**Step 2: Update context and prompt**

Keep voice and keyboard on the same existing submit pipeline. Deletion operations are emitted only after intent and target are resolved.

**Step 3: Enforce event visibility**

Exclude `status=closed` from Home, search, direct detail, and model candidate reads while retaining records for audit and undo.

**Step 4: Run assistant tests**

Run: `npm test`

Expected: PASS.

### Task 5: Apply confirmed UI polish

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `src/components/CalendarSyncSetting.tsx`
- Modify: `src/components/XiaozhiEyesIcon.tsx`

**Step 1: Reuse the exact data-management divider style**

Apply `styles.dataRowBorder` to notification and calendar rows; remove duplicate divider definitions.

**Step 2: Refine Xiaozhi selected spacing and eyes**

Move only the selected face upward by 3 px. Use shared-eye motion targets with horizontal travel ±3.5 px, vertical travel ±2 px, and 0.9–1.5 second intervals.

**Step 3: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

### Task 6: Full verification and delivery

**Files:**
- Include confirmed design artifacts and this plan in the existing branch/PR.

**Step 1: Run full CI**

Run: `npm run ci`

Expected: all tests, typecheck, and lint pass.

**Step 2: Device verification**

Reload the existing Dev build through the current Expo tunnel. Manually verify eye motion/spacing, divider consistency, voice/text todo deletion, event keep/cascade confirmation, receipts, undo, and closed-event visibility.

**Step 3: Commit and push**

Commit to `codex/xiaozhi-todos-events` and push to existing PR #19.

**Step 4: Report acceptance package**

Provide commit, PR, automated results, device/build used, manual cases, data/native impact, risks, and rollback point. Do not merge or write final release knowledge until the user accepts device behavior.
