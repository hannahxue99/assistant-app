# Importable Markdown Backup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every new Markdown export from the App safely importable into an empty or populated local database.

**Architecture:** Keep the human-readable Markdown unchanged and append a versioned machine-readable backup capsule. Parse and validate the capsule with pure functions, preview the merge without writes, then apply it in one SQLite transaction using an internal revision timestamp for conflict resolution.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, expo-sqlite, expo-file-system/legacy, expo-document-picker, local notification rescheduling.

---

### Task 1: Versioned backup format

**Files:**
- Create: `src/engine/backup-format.ts`
- Create: `scripts/test-backup-format.ts`
- Modify: `src/types.ts`
- Modify: `package.json`

**Steps:**
1. Define backup envelope, payload, topic preference, preview, and result types.
2. Write failing tests for round-trip Unicode content, invalid marker, unsupported version, duplicate IDs, and malformed fields.
3. Implement V2 capsule serialization and strict parsing without guessing from display Markdown.
4. Run `npm run test:backup` and verify all format tests pass.
5. Commit the format and tests.

### Task 2: Revision-aware database migration and export

**Files:**
- Modify: `src/db.ts`
- Modify: `src/types.ts`
- Modify: `scripts/test-topic-order.ts`
- Modify: `package.json`

**Steps:**
1. Add `entries.revision_at` with idempotent migration and backfill from `updated_at`.
2. Update every entry mutation that changes exported data to advance `revision_at`, without changing the UI meaning of `updated_at`.
3. Read all entries, profile, and pinned topic preferences into a backup payload.
4. Change `exportMarkdown()` to append the V2 capsule while preserving readable output.
5. Run type checking and existing tests.
6. Commit the migration and export changes.

### Task 3: Preview and transactional merge

**Files:**
- Create: `src/engine/import-merge.ts`
- Create: `scripts/test-import-merge.ts`
- Modify: `src/db.ts`
- Modify: `package.json`

**Steps:**
1. Write pure merge-classification tests for add, identical ignore, newer incoming update, newer local keep, equal-revision conflict, and idempotent repeat.
2. Implement pure preview classification.
3. Add the idempotent `import_conflicts` table.
4. Implement one exclusive SQLite transaction for entries, conflict snapshots, profile-default restoration, and newer topic pin restoration.
5. Rebuild FTS after commit and return affected entries for notification rescheduling.
6. Run import tests, type checking, and existing tests.
7. Commit the merge implementation.

### Task 4: System file picker and import UI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/(tabs)/profile.tsx`
- Create: `src/components/ImportPreviewModal.tsx`

**Steps:**
1. Install the Expo SDK 57-compatible `expo-document-picker` package.
2. Add the “数据管理” rows matching the approved design.
3. Open the system picker with `copyToCacheDirectory: true`, restrict by extension after selection, and enforce the file-size limit before reading.
4. Parse the V2 capsule, compute preview counts, and show the approved confirmation modal.
5. On confirmation, run transactional import, reschedule affected entry reminders, refresh daily notifications, and show success or partial-warning feedback.
6. Show actionable errors for legacy exports, unsupported versions, invalid files, and oversized files.
7. Run type checking and tests.
8. Commit the UI integration.

### Task 5: Verification, documentation, and PR

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-09-04-importable-markdown-design.md`

**Steps:**
1. Run `npm run typecheck` and every `test:*` script.
2. Verify exported Markdown contains readable text, full V2 data, and no LLM key.
3. Exercise export → select file → preview → merge → repeat import on a simulator or document the required phone verification if no runtime is available.
4. Mark the design implemented and document known legacy-file limitations.
5. Push `codex/importable-markdown` and open a PR against `main`.
6. Report automated results, manual verification steps, PR URL, and rollback point.

