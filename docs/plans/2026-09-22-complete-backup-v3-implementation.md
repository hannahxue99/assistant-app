# Complete Backup V3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export and import one canonical `assistant-app-export-v3` semantic backup format while preserving the existing V2 and legacy import entry points without duplicating legacy projections in V3.

**Architecture:** Keep V2 unchanged and add isolated V3 format and merge-planning modules. A dedicated V3 database module reads one consistent SQLite snapshot, recomputes merge decisions inside one exclusive write transaction, and leaves FTS, notification, and calendar work as durable post-commit projections. The existing Profile screen remains the only user entry and dispatches by detected format.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Expo SQLite exclusive transactions, Markdown JSON capsules, Node-based regression scripts.

---

### Task 1: Define and validate the V3 envelope

**Files:**
- Create: `src/engine/backup-v3-format.ts`
- Create: `scripts/test-backup-v3-format.ts`
- Modify: `package.json`

**Step 1: Write the failing format tests**

Cover a complete payload containing entries, profile, topic preferences, segments, requests, messages, events, aliases, updates, relations, operations, memories, and memory sources. Assert:

- `buildBackupV3Markdown` emits `assistant-app-export-v3` and a V3-only capsule marker.
- `parseBackupV3Markdown` round-trips every field and count.
- V2 text returns a format-mismatch result so the caller can fall back to V2.
- A future schema version raises `UNSUPPORTED_VERSION` instead of falling through to legacy parsing.
- Duplicate IDs, count mismatches, invalid enums/timestamps/lengths, dangling references, memory replacement cycles, request/message mismatch, relation target mismatch, and duplicate request sequence values are rejected before SQLite access.
- API keys, base URLs, reasoning, decision logs, tool traces, device calendar IDs, and notification IDs have no representable V3 fields.

**Step 2: Run the test and verify it fails**

Run: `npm run test:backup-v3`

Expected: FAIL because the V3 module does not exist.

**Step 3: Implement the standalone V3 module**

Define explicit backup types rather than widening `BackupEnvelope` V2. Use:

```ts
type BackupV3Format = 'assistant-app-export-v3';

interface BackupEnvelopeV3 {
  format: BackupV3Format;
  schemaVersion: 3;
  exportedAt: number;
  counts: Record<BackupV3ObjectKind, number>;
  payload: BackupPayloadV3;
}
```

Keep validation pure and deterministic. Validate all references in memory before returning the parsed envelope. Escape consecutive hyphens before embedding JSON in the Markdown HTML comment.

**Step 4: Run focused tests**

Run: `npm run test:backup-v3`

Expected: all V3 format and reference-integrity cases pass.

**Step 5: Register the test**

Add `test:backup-v3` to the aggregated `npm test` command.

**Step 6: Commit**

```bash
git add src/engine/backup-v3-format.ts scripts/test-backup-v3-format.ts package.json
git commit -m "feat: define complete backup v3 format"
```

### Task 2: Build deterministic V3 merge planning

**Files:**
- Create: `src/engine/backup-v3-import.ts`
- Create: `scripts/test-backup-v3-import.ts`
- Modify: `package.json`

**Step 1: Write failing merge tests**

Test immutable facts, revisioned objects, request groups, current segments, and operations:

- Missing immutable facts add; identical facts ignore; conflicting IDs keep local and record both snapshots.
- Entries use `revisionAt`; events and memories use `revision`; segments use `updatedAt`.
- A non-empty local database keeps its current segment; an incoming current segment is restored closed and records a conflict instead of violating the unique index.
- A conflicting user message skips its request, assistant message, and operations as one group.
- An operation is eligible only when the imported target equals its parsed `afterSnapshot`.
- A target won by local state skips undo restoration and increments `operationSkipped`.
- Repeating the same V3 import produces only ignore decisions.

**Step 2: Run the test and verify it fails**

Run: `npm run test:backup-v3-import`

Expected: FAIL because the planner does not exist.

**Step 3: Implement pure classifiers and preview aggregation**

Return a plan containing decisions by object kind, conflict records, affected entry IDs, eligible operations, skipped operation count, and UI metrics. Do not query or write SQLite from this module.

**Step 4: Run focused tests and register them**

Run: `npm run test:backup-v3-import`

Expected: all merge, idempotency, and operation-eligibility cases pass. Add the command to `npm test`.

**Step 5: Commit**

```bash
git add src/engine/backup-v3-import.ts scripts/test-backup-v3-import.ts package.json
git commit -m "feat: plan safe backup v3 merges"
```

### Task 3: Add schema and transaction-safe database restoration

**Files:**
- Create: `src/engine/backup-v3-database.ts`
- Create: `scripts/test-backup-v3-database.cjs`
- Modify: `src/db.ts`
- Modify: `package.json`

**Step 1: Write failing database tests**

Use an in-memory SQLite adapter with foreign keys enabled. Seed a complete semantic graph, export it, import into an empty database, and assert all object counts, contents, and key relations. Also assert:

- Snapshot reads use the transaction handle for every table.
- `pending` requests and `sending` messages export as retryable failed states with `interrupted_at_export`.
- The export fails on an orphan request without its user message.
- Legacy-projected messages without requests do not fail export: their source `entries` remain, the projection messages and now-unused segments are omitted, and references from retained facts are normalized safely.
- Relations whose message endpoint is an omitted legacy projection are omitted; other retained relations only lose an invalid `sourceMessageId`.
- Historical operations whose targets were later deleted, undone, or changed remain exportable; import planning skips undo restoration unless the current target still equals `afterSnapshot`.
- Reimport is idempotent.
- Local-newer conflicts persist both snapshots in `assistant_import_conflicts`.
- A deliberately injected write failure rolls back all facts and conflict rows.
- Ineligible operations do not restore undo ability.
- V2 database import behavior remains unchanged.

**Step 2: Run the database test and verify it fails**

Run: `npm run test:backup-v3-db`

Expected: FAIL because the schema and database module do not exist.

**Step 3: Add additive schema**

Add:

```sql
CREATE TABLE IF NOT EXISTS assistant_import_conflicts (...);
CREATE TABLE IF NOT EXISTS assistant_projection_jobs (...);
```

Conflict rows contain object kind, object ID, local/incoming JSON, winner, reason, source export time, and import time. Projection jobs contain a stable kind and retry timestamps; they are device-local and never exported.

**Step 4: Implement consistent export**

Read all V3 tables through one `withExclusiveTransactionAsync` callback and the provided transaction object. Map rows to semantic camelCase types, normalize interrupted runtime states in memory, build the readable summary, and emit the V3 capsule. Never read `settings`, reasoning, decision logs, calendar mappings, notification identifiers, or migration tables.

Treat `entries` as the canonical representation of old records. Before validating the snapshot, exclude messages with `source='legacy'` or a non-null `legacyEntryId`, keep only segments referenced by exported messages, clear retained facts' `sourceMessageId` when it points outside the exported message set, and omit relations whose `fromType` or `toType` is `message` with an omitted endpoint. Do not create synthetic requests and do not mutate SQLite.

**Step 5: Implement preview and exclusive import**

Preview reads local facts and runs the pure planner. Confirmed import starts a new exclusive transaction, rereads local facts, recomputes the plan, and writes in dependency order:

```text
entries/profile/preferences
segments → requests → messages
events → aliases → updates
memories → memory sources
relations → eligible operations
conflicts → durable projection jobs
```

Return only after the fact transaction commits.

**Step 6: Implement projection recovery**

- Notification intent continues through `notification_sync_queue`.
- Calendar triggers continue to enqueue `calendar_jobs` when entries change.
- FTS rebuild runs after commit; failure leaves an `assistant_projection_jobs` row.
- Database initialization retries pending FTS rebuilds without rolling back restored facts.

**Step 7: Run focused tests and register them**

Run: `npm run test:backup-v3-db`

Expected: full restore, rollback, idempotency, conflict, interrupted-state, and projection retry tests pass. Add the command to `npm test`.

**Step 8: Commit**

```bash
git add src/engine/backup-v3-database.ts src/db.ts scripts/test-backup-v3-database.cjs package.json
git commit -m "feat: restore complete backup v3 transactionally"
```

### Task 4: Wire V3 export and import into the existing Profile flow

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `src/components/ImportPreviewModal.tsx`
- Modify: `src/components/ImportFeedbackModal.tsx`
- Create: `scripts/test-backup-v3-ui.ts`
- Modify: `package.json`

**Step 1: Write failing UI-state tests**

Test pure display helpers for:

- V3 preview object counts and add/update/ignore/conflict totals.
- Conversation date range.
- `operationSkipped` warning.
- Private-content warning before confirmation.
- Result copy that distinguishes restored facts from pending projections.
- V2 and legacy preview copy remaining unchanged.

**Step 2: Run the UI test and verify it fails**

Run: `npm run test:backup-v3-ui`

Expected: FAIL because V3 preview data is unsupported.

**Step 3: Dispatch import by capsule version**

File selection remains user-initiated with `copyToCacheDirectory: true`. Parse in this order:

```text
V3 capsule → V2 capsule → legacy export
```

A recognized future V3 version must stop with “App version too old”; it must not fall through to V2 or legacy parsing. Keep the existing file-size guard.

**Step 4: Export V3 and enforce self-importability**

The export button writes the V3 Markdown returned by the database module. Before sharing, verify its UTF-8 size does not exceed the same import limit; otherwise show an explicit error rather than creating a backup this App cannot restore. Continue using the SDK 57 cache file plus `Sharing.isAvailableAsync()` flow.

**Step 5: Extend preview and result surfaces**

Follow `docs/plans/2026-09-22-complete-backup-v3-flow.svg`. Add V3 as a third typed candidate without adding navigation or developer copy. Confirmation invokes the V3 importer and then best-effort projection processing.

**Step 6: Run focused tests and register them**

Run: `npm run test:backup-v3-ui`

Expected: V3, V2, and legacy UI-state cases pass. Add the command to `npm test`.

**Step 7: Commit**

```bash
git add app/(tabs)/profile.tsx src/components/ImportPreviewModal.tsx src/components/ImportFeedbackModal.tsx scripts/test-backup-v3-ui.ts package.json
git commit -m "feat: add complete backup v3 recovery flow"
```

### Task 5: Verify security, compatibility, and full CI

**Files:**
- Modify as required by failing tests only.

**Step 1: Run all focused backup tests**

Run:

```bash
npm run test:backup
npm run test:import
npm run test:backup-v3
npm run test:backup-v3-import
npm run test:backup-v3-db
npm run test:backup-v3-ui
```

Expected: all pass.

**Step 2: Run static verification**

Run: `npm run typecheck`

Expected: pass.

Run: `git diff --check`

Expected: no output.

**Step 3: Run complete CI**

Run: `npm run ci`

Expected: TypeScript and every aggregated test group pass.

**Step 4: Inspect the exported fixture**

Assert the generated Markdown contains user facts and the V3 marker but does not contain seeded API keys, base URLs, reasoning, decision logs, tool traces, calendar IDs, or notification IDs.

**Step 5: Push the existing PR and wait for GitHub**

Push `codex/backup-v3-design`, update PR #27 from design-only to implementation, and require GitHub `CI / validate` to pass. Automated checks make the PR ready for acceptance; do not merge.

### Task 6: Device and Release-data acceptance after user approval

**Files:**
- Do not change production code during acceptance unless a defect is found and returned through the normal test cycle.

**Step 1: Read the device/release instructions**

Load the device sections routed by `assistant-app-work`, including the Reload and Release-data safeguards.

**Step 2: Use a copy of Release data**

Never use the only production database for the first restore. Export V3 from a Release-data copy, import it into a clean compatible environment, and compare counts plus representative message-event-todo-memory relations.

**Step 3: Verify the user flow**

Check file selection, V3 preview, confirmation, result messaging, repeat import, a deliberate conflict, and projection recovery. Verify V2 import still works.

**Step 4: Record acceptance evidence**

Capture build identity, Bundle ID, source commit, endpoint or installed artifact, database-copy provenance, scenarios, and unresolved risks. Only after user acceptance update `docs/knowledge/` and its index, merge, sync `main`, and perform any required device delivery.
