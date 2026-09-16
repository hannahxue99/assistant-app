# Home Cleanup, Legacy Import, and Composer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the legacy memo UI, import baseline Markdown exports into Xiaozhi/todos/events, and replace hold-to-talk with a Codex-style editable dictation composer.

**Architecture:** Parse legacy Markdown into a typed, deterministic intermediate representation with stable fingerprints. Import it through an idempotent SQLite projection that writes legacy entries, chronological user messages, todos, events, event updates, and relations without a model call. Keep the composer local to the existing speech-recognition module and model its visual/interaction rules as pure testable state.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, expo-document-picker, expo-file-system/legacy, expo-sqlite, expo-speech-recognition, TypeScript, tsx tests.

---

### Task 1: Parse the exact baseline Markdown format

**Files:**
- Create: `src/engine/legacy-backup.ts`
- Create: `scripts/test-legacy-backup.ts`
- Modify: `package.json`

**Step 1: Write failing parser tests**

Cover the repository baseline format: `## 待办 ✅完成 · timestamp`, quoted raw text, optional understanding/topic/tags/time, ideas and information, invalid timestamps, unrelated Markdown, and repeated records.

**Step 2: Run the focused test and verify failure**

Run: `npm run test:legacy-backup`
Expected: FAIL because the parser module does not exist.

**Step 3: Implement strict parsing and stable fingerprints**

Produce typed records with exact raw text, kind, summary, due date, completion state, topic, tags, source timestamp, inferred time precision, and a stable `legacy-import-*` ID. Do not call date or language models.

**Step 4: Run the focused test**

Run: `npm run test:legacy-backup`
Expected: all parser cases pass.

### Task 2: Import legacy records into all visible first-class objects

**Files:**
- Create: `src/assistant/legacy-import.ts`
- Create: `src/assistant/stable-id.ts`
- Modify: `src/assistant/event-migration.ts`
- Modify: `src/db.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`

**Step 1: Write failing SQLite integration cases**

Assert preview counts, no writes before confirmation, chronological `legacy` messages, direct todo preservation, topic-to-event updates and relations, same-file idempotency, natural duplicate detection, and rollback on invalid data.

**Step 2: Run the database test and verify failure**

Run: `npm run test:assistant-actions-db`
Expected: FAIL because legacy import functions do not exist.

**Step 3: Implement preview and transactional import**

Use one exclusive SQLite transaction. Insert only missing stable records; maintain the closed `legacy-history` segment bounds; write messages without assistant replies; create/merge deterministic legacy events; append one stable event update per imported topical record; link message and task sources; update FTS and notification compensation rows.

**Step 4: Run database and assistant UI tests**

Run: `npm run test:assistant-actions-db && npm run test:assistant-ui`
Expected: PASS with no duplicate objects after a second import.

### Task 3: Add auto-detected preview and immediate projection to Data Management

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `src/components/ImportPreviewModal.tsx`
- Modify: `src/components/ImportFeedbackModal.tsx`

**Step 1: Add an import candidate union**

Represent V2 backup and legacy export separately so confirmation cannot execute the wrong importer.

**Step 2: Auto-detect after file selection**

Try the V2 capsule parser first; only on `LEGACY_OR_UNKNOWN`, try the strict baseline parser. Unrelated or malformed Markdown remains rejected.

**Step 3: Render format-specific preview and feedback**

Legacy preview shows conversation, todo, event, and duplicate counts. V2 keeps added/updated/ignored/conflict metrics. After either successful path, immediately run legacy message/event projection so restored content is visible without restarting.

**Step 4: Type-check**

Run: `npm run typecheck`
Expected: PASS.

### Task 4: Remove the entire memo surface from Home

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: Remove rendered UI**

Delete the memo heading, aggregate/voice tabs, search boxes, cards, understanding banner, and bottom quick composer.

**Step 2: Remove dead reads and handlers**

Stop loading list entries/topic groups for Home. Preserve todo/event loading, pinning, route focus, notifications, and local refresh subscriptions.

**Step 3: Type-check and inspect the diff**

Run: `npm run typecheck && git diff --check`
Expected: PASS; no legacy memo imports or state remain in Home.

### Task 5: Implement the Codex-style editable dictation composer

**Files:**
- Create: `src/assistant/composer-state.ts`
- Create: `scripts/test-assistant-composer.ts`
- Modify: `src/components/AssistantComposer.tsx`
- Modify: `package.json`

**Step 1: Write failing state tests**

Cover typed text plus interim/final speech, one-tap start/stop, disabled send while listening, retained transcript after stop/error, send enablement, and processing state.

**Step 2: Run the focused test and verify failure**

Run: `npm run test:assistant-composer`
Expected: FAIL because composer state helpers do not exist.

**Step 3: Implement the visual and interaction states**

Use a single rounded container, tap-to-start/tap-to-stop mic, live transcript in the same `TextInput`, editable text after stop, one-to-five-line growth, active orange send button, and the existing cleared/grey processing state. Abort recognition on unmount without submitting.

**Step 4: Run focused tests and type-check**

Run: `npm run test:assistant-composer && npm run typecheck`
Expected: PASS.

### Task 6: Verify, document, commit, and deliver through the existing PR

**Files:**
- Modify: `docs/plans/2026-09-15-home-cleanup-legacy-import-composer-design.md`
- Modify: `docs/plans/2026-09-15-event-card-todo-navigation-design.md` if Home wording requires alignment
- Add the approved SVG and PNG design artifacts

**Step 1: Run the aggregate gate**

Run: `npm run ci`
Expected: TypeScript and every registered test pass.

**Step 2: Review migration and UI diffs**

Verify no model call in import, no native dependency/config changes, no Home memo code, and no accidental data deletion.

**Step 3: Commit and push**

Commit logical parser/import, Home, and composer changes to `codex/xiaozhi-todos-events`, then push to existing PR #19.

**Step 4: Reload the existing Dev session**

Send `r` to Metro session `33273`; confirm iOS bundle completion. Device acceptance covers legacy import preview/result, Home removal, and the four composer states.
