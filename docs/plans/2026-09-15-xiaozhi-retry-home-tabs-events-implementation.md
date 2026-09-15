# Xiaozhi Retry, Home Todo Tabs, and Event Cards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace JSON-only repair with one full model retry, add non-overlapping todo tabs with precise Xiaozhi navigation, and refine event cards and detail actions.

**Architecture:** Keep one saved user request and one atomic commit. The provider executes at most two independent full attempts against one immutable prompt snapshot; the home screen projects existing week and long-term task queries into two in-place tabs; event pinning changes presentation order without changing content activity time.

**Tech Stack:** Expo SDK 57, Expo Router, React Native 0.86, TypeScript, Expo SQLite, existing Node/tsx test harness.

---

### Task 1: Lock the accepted behavior with failing tests

**Files:**
- Modify: `scripts/test-assistant-protocol.ts`
- Modify: `scripts/test-assistant-turn.cjs`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-assistant-ui.ts`
- Modify: `scripts/test-schedule.ts`

1. Replace JSON repair fixtures with: invalid first full response then valid second full response; two invalid responses; non-retryable 401; retryable 429/5xx; first streamed text reset before retry.
2. Assert retry uses the same full context, reference time and model request rather than a repair prompt.
3. Assert decision logs persist provider attempt count and per-attempt bounded diagnostics.
4. Assert pinning does not mutate event `updated_at`; pinned and ordinary groups each sort by `updated_at DESC, id DESC`.
5. Assert todo receipt targets contain `todoView=week|all` and `focusTodoId`, with the exact existing seven-day boundary; no-date todos have no target.
6. Assert long-term grouping contains only tasks at or after the seven-day boundary.
7. Run focused tests and confirm they fail for the intended missing behavior.

### Task 2: Replace JSON repair with one full request retry

**Files:**
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/decision-log.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/action-schema.ts`
- Modify: `src/db.ts`

1. Build prompt messages once per user turn and pass that immutable array to each attempt.
2. Extract one full provider attempt with its own 45-second abort controller and caller cancellation propagation.
3. Delete repair prompt/request functions and all repair branches.
4. Retry exactly once for network, timeout, empty/invalid response, HTTP 429 and 5xx; do not retry missing key, caller cancellation, 400/401/403, validation rejection or SQLite failures.
5. Clear the first attempt's temporary streamed reply before the second attempt starts.
6. Add additive decision-log columns `provider_attempt_count` and `provider_attempts_json`; keep legacy repair columns only for existing databases.
7. Record each attempt's code/detail, duration, finish reason and available usage without storing prompts, keys or full response bodies.
8. Run protocol, turn and database tests.

### Task 3: Add in-place home todo tabs and precise receipt navigation

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/assistant/ui-state.ts`
- Modify: `src/engine/schedule.ts`
- Modify: `scripts/test-assistant-ui.ts`
- Modify: `scripts/test-schedule.ts`

1. Load both `listWeekTasks` and existing `listLongTermTasks` during the same home refresh.
2. Add `week | all` local selection state; render `本周待办｜全部待办`, with the latter always smaller and both controls at least 44px high.
3. Default to week, preserve manual selection while mounted, and let `todoView` navigation params select the intended tab.
4. Render week and long-term groups through one row component; “全部待办” contains only the seven-day-window-after data and never duplicates week tasks.
5. Parse the committed todo snapshot in `assistantReceiptTarget`; create a home target with `focusTodoId` and the correct view, or no target for undated todos.
6. Measure the direct todo row within the home todo section, scroll to the target and apply a temporary highlight. Missing/completed targets open the selected tab without recreating data.
7. Keep checkbox completion/reminder behavior identical in both tabs; show module-local empty/error states.
8. Run UI, schedule and TypeScript checks.

### Task 4: Refine event cards, pinning and detail actions

**Files:**
- Modify: `src/components/AssistantEventCard.tsx`
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/assistant/event-store.ts`
- Modify: `app/event/[id].tsx`
- Modify: `scripts/test-assistant-actions-database.cjs`

1. Render stable three-line cards: title, raw progress content without a label, and updated timestamp.
2. Reuse the existing `TopicPinIcon` in an independent 44px top-right control; card body navigates to detail and pin control does not.
3. Handle one pin mutation at a time, reload on revision conflict/failure, and keep other cards usable.
4. Change event list SQL to pinned group first and `updated_at DESC, id DESC` inside each group.
5. Change `setEventPinned` to update only `pinned_at` and revision, never `updated_at`.
6. Remove event-detail pin, overflow and manual rename UI/code; keep back, content, todo completion, progress and Xiaozhi entry.
7. Remove the linked-todo text navigation from event detail; checkbox stays active.
8. Run event database, UI and type checks.

### Task 5: Verify, document, deliver and reload Dev

**Files:**
- Modify: `docs/plans/2026-09-15-xiaozhi-navigation-resilience-design.md`
- Modify: `docs/plans/2026-09-15-xiaozhi-full-request-retry-design.md`
- Modify: `docs/plans/2026-09-15-event-card-todo-navigation-design.md`
- Modify: relevant `docs/knowledge/*` after device acceptance

1. Mark accepted designs implemented but awaiting Dev acceptance; mark JSON-only repair as superseded.
2. Remove obsolete draft visual files and retain the accepted event-card and todo-tab artifacts.
3. Run focused tests, `npm test`, then `npm run ci` with Node 24.
4. Review the diff, commit in reviewable units, and push the existing `codex/xiaozhi-todos-events` branch to PR #19.
5. Confirm GitHub `CI / validate` status.
6. Reuse the existing Metro/Tunnel and send Reload; never start a second endpoint or require the user to reinstall.
7. Ask for device acceptance before merge; after acceptance update the knowledge index and rollback point.
