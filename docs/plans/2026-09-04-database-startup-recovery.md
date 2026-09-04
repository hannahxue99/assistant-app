# Database Startup Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Prevent database startup races from surfacing as an unhandled development error and provide a recoverable user-facing startup state when SQLite truly cannot initialize.

**Architecture:** Keep one hot-reload-stable database runtime on `globalThis`, publish the database handle only after schema initialization completes, and make concurrent initialization calls share one promise. Treat database/migration startup as critical, while notification scheduling remains best-effort and catches detached promise failures. The root layout renders loading, ready, or the approved retry screen.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, `expo-sqlite`, `expo-notifications`, TypeScript.

---

### Task 1: Make database initialization single-flight and hot-reload-stable

**Files:**
- Modify: `src/db.ts`
- Test: `scripts/test-database-runtime.ts`
- Modify: `package.json`

1. Add a small testable single-flight runtime helper.
2. Verify concurrent callers share one initialization and failures can be retried.
3. Store the SQLite runtime on `globalThis` so Fast Refresh does not erase the ready handle.
4. Publish the handle only after schema setup and migrations finish.
5. Run the focused test and typecheck.

### Task 2: Separate critical startup from best-effort notification work

**Files:**
- Modify: `app/_layout.tsx`
- Modify: `src/engine/notifications.ts`

1. Keep database initialization and legacy migration in the critical startup path.
2. Run notification setup, permission checks, scheduling, queue compensation, and understanding retries as guarded background work.
3. Catch the detached daily-notification refresh promise.
4. Render the approved retry page if critical startup fails; retry performs initialization again.
5. Run typecheck and notification tests.

### Task 3: Verify and prepare the PR

**Files:**
- Modify: `docs/plans/2026-09-04-database-startup-recovery.md` only if verification reveals a design correction.

1. Run all repository test scripts.
2. Run Expo export as a production-bundle smoke test.
3. Review the diff for accidental native dependency or database-schema changes.
4. Commit, push the dedicated branch, and open a GitHub PR with acceptance instructions.

## Acceptance criteria

- Repeated Reload/Fast Refresh does not show `数据库未初始化` or an unhandled-promise overlay.
- Concurrent startup callers cannot query a partially migrated database.
- A failed initialization can be retried without reinstalling the App.
- Notification refresh failure never rolls back or hides a successfully saved record.
- A true database startup failure shows the approved friendly retry page rather than the main app or technical error text.
- No native dependency, Bundle ID, or database schema change is introduced; this build can be accepted with Reload.

## Rollback point

Revert this PR. It introduces no schema migration or data transformation, so existing local records remain compatible with the previous app version.
