# Entry Date Edit Confirmation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Make title/body edits explicitly resolve due-date changes and conflicts before saving.

**Architecture:** Add a pure date-edit decision engine between the detail screen and the database. The screen renders native confirmations from the decision, while `applyCorrection` only applies an explicitly supplied due-date patch and preserves topic/completion state transactionally.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Expo SQLite, Expo Notifications.

---

### Task 1: Date evidence and decision engine

**Files:**
- Modify: `src/engine/time.ts`
- Create: `src/engine/edit-date-decision.ts`
- Create: `scripts/test-edit-date-decision.ts`

1. Add tests for title-only, body-only and simultaneous edits across absent, unchanged, changed, deleted, conflicting and multiple dates.
2. Run the test and verify it fails before implementation.
3. Implement date-evidence extraction, calendar-day comparison and explicit decision states.
4. Run the focused test and verify all cases pass.

### Task 2: Transaction contract

**Files:**
- Modify: `src/engine/edit-derived.ts`
- Modify: `src/db.ts`
- Modify: `scripts/test-entry-consistency.cjs`

1. Add regression assertions that body edits do not silently rewrite titles or dates.
2. Change correction derivation to preserve the title and existing due date unless the caller explicitly supplies `dueAt`.
3. Verify FTS, notification queue and rollback behavior remain atomic.

### Task 3: Detail-screen confirmations

**Files:**
- Modify: `app/entry/[id].tsx`

1. Analyze drafts before save.
2. Directly save unchanged-date edits; show native confirmation for date changes, date removal and title/body conflicts.
3. When the user selects one side of a conflict, synchronize the other side's date expression under that explicit authorization.
4. Keep drafts open for ambiguous multiple dates and failed saves.

### Task 4: Verification and delivery

**Files:**
- Modify: `package.json`

1. Add the focused decision test script.
2. Run typecheck, decision tests, time tests, entry-consistency integration tests and the existing suite.
3. Commit, push the dedicated branch and create a PR.
4. Provide Metro Reload cases for device acceptance; do not merge before acceptance.
