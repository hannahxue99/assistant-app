# Calendar Time Precision Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve validated timed todo precision through FTS updates and safely repair Release todos whose committed structured `dateTime` intent was overwritten to `date`.

**Architecture:** Make FTS synchronization projection-only, move precision ownership back to each fact-writing path, and add an idempotent evidence-based migration that reconstructs the latest committed date proposal for each affected todo. Existing calendar triggers will enqueue repaired entries and update the owned EventKit event.

**Tech Stack:** TypeScript, Expo SDK 57, Expo SQLite, Node SQLite test harness, Expo Calendar Next.

---

### Task 1: Lock the regression with database tests

**Files:**
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-calendar-sync.cjs`

**Step 1: Write a failing database test**

Create a todo whose text contains no clock, then update it through `updateAssistantTaskWithDatabase` with a 15:00 `dueAt` and `timePrecision: 'dateTime'`. Assert the returned row and SQLite row remain `dateTime` after FTS synchronization.

**Step 2: Add projection coverage**

Pass the persisted row to `calendarProjection` and assert `allDay === false` and a one-hour duration.

**Step 3: Run the focused tests**

Run: `npm run test:assistant-actions-db && npm run test:calendar`

Expected: the new database assertion fails because FTS changes the precision to `date`.

### Task 2: Remove the FTS side effect and preserve explicit writers

**Files:**
- Modify: `src/db.ts`
- Test: `scripts/test-assistant-actions-database.cjs`

**Step 1: Restrict `syncFtsWithDatabase`**

Remove its `UPDATE entries SET time_precision` statement. It should only delete and insert `entries_fts` rows.

**Step 2: Keep inference at fact-writing boundaries**

Set inferred precision explicitly in legacy/rule/manual write paths that previously relied on FTS. Preserve `input.timePrecision` in assistant create/update paths and stored precision in imports.

**Step 3: Run focused tests**

Run: `npm run test:assistant-actions-db && npm run test:edit-date && npm run test:calendar && npm run test:backup-v3-db`

Expected: all pass, including the new `dateTime` assertion.

### Task 3: Add evidence-based Release data repair

**Files:**
- Create: `src/assistant/time-precision-migration.ts`
- Modify: `app/_layout.tsx`
- Modify: `scripts/test-assistant-actions-database.cjs`

**Step 1: Write failing migration fixtures**

Build committed assistant request, decision-log and operation rows matching the Release incident: the proposal and validator say `dateTime`, the entry timestamp is 15:00, and the stored precision is `date`. Add negative fixtures for mismatched timestamps, malformed JSON, a later `date` proposal, and uncommitted operations.

**Step 2: Implement proposal reconstruction**

Parse normal proposed operations and deterministically flatten event-delta todo proposals. Match by `operation_key`, committed ID and accepted validation key. Use `projectModelDate` to validate the date instead of duplicating calendar parsing.

**Step 3: Implement the idempotent migration**

Within an exclusive transaction, inspect each affected todo's operations newest-first, repair only the latest trustworthy date intent, insert migration key `assistant-time-precision-structured-v1`, and return the repair count.

**Step 4: Wire startup compensation**

Run the migration after database initialization and interrupted-request recovery, before the UI becomes ready. Treat failure as retryable and non-blocking, matching existing assistant migrations.

**Step 5: Run focused tests**

Run: `npm run test:assistant-actions-db && npm run test:calendar`

Expected: the incident fixture repairs once, queues calendar sync, and the second run repairs zero rows; all negative fixtures remain unchanged.

### Task 4: Verify the full repository contract

**Files:**
- Modify if needed: `package.json`
- Modify if needed: `scripts/test-agent-tooling.cjs`

**Step 1: Confirm aggregation**

Verify every added assertion runs through an existing `npm test` script. Do not add a standalone unaggregated test command.

**Step 2: Run focused static verification**

Run: `npm run typecheck`

Expected: pass.

**Step 3: Run the complete gate**

Run: `npm run ci`

Expected: pass with no uncommitted generated artifacts.

### Task 5: Commit, push, and open the PR

**Files:**
- Modify: `docs/plans/2026-10-05-calendar-time-precision-repair-design.md`
- Modify: `docs/plans/2026-10-05-calendar-time-precision-repair.md`

**Step 1: Review the diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only scoped code, tests, and plan documents.

**Step 2: Commit reviewable history**

Create separate commits for the validated design and the tested implementation where practical.

**Step 3: Push and create a PR**

Open a PR against `main` describing the Release evidence, safe data repair, verification, native impact (`none`), and rollback. Do not merge before user acceptance and GitHub `CI / validate` passes.

**Step 4: Prepare acceptance**

Provide the exact Release/Dev validation scenario, but do not claim device delivery until the installed app produces the repaired timed event on the phone.
