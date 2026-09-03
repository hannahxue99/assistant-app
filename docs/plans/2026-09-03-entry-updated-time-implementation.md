# Entry Updated Time Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate immutable creation time from user-edit time, and consistently sort and display entries by their latest content activity.

**Architecture:** Add a backward-compatible `updated_at` column to SQLite and map it to `Entry.updatedAt`. Only user content corrections advance this value; parsing, completion, pinning, and topic renaming do not. Lists derive activity order from `updatedAt`, while task lists continue to use due dates.

**Tech Stack:** Expo SDK 57, expo-sqlite, TypeScript, React Native, tsx test scripts

---

### Task 1: Add the timestamp contract and migration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/db.ts`
- Test: `scripts/test-entry-time.ts`

1. Add `updatedAt` to `Entry` and a small helper for edited-state semantics.
2. Add `updated_at` to fresh databases and conditionally migrate existing databases using `PRAGMA table_info(entries)`.
3. Backfill old rows from `created_at` and index the new column.
4. Insert new records with identical creation and update timestamps.

### Task 2: Update content mutation behavior

**Files:**
- Modify: `src/db.ts`
- Test: `scripts/test-entry-time.ts`

1. Advance `updated_at` in `applyCorrection` only.
2. Keep background parsing, task completion, topic rename, and pin operations from changing it.
3. Confirm a no-change UI save exits without calling the correction write path.

### Task 3: Apply activity ordering and display rules

**Files:**
- Modify: `src/db.ts`
- Modify: `src/engine/topic-order.ts`
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/topic/[name].tsx`
- Modify: `app/entry/[id].tsx`
- Test: `scripts/test-topic-order.ts`

1. Sort general entries, search results, topic groups, and topic entries by `updated_at`.
2. Keep pinned topics ahead of unpinned topics; sort each section by topic `updatedAt`.
3. Show aggregate/raw-card timestamps without persistent “最新” or “编辑” prefixes.
4. On entry detail, show creation time always and edit time only after a real edit.

### Task 4: Synchronize design, cases, and knowledge

**Files:**
- Modify: `DESIGN_SYSTEM.md`
- Modify: `TESTCASES.md`
- Create: `docs/knowledge/entry-time.md`
- Modify: `docs/knowledge/INDEX.md`

1. Record the source-of-truth display and sorting rules.
2. Document migration and mutation pitfalls.
3. Run typecheck and all test scripts, then open a reviewable PR.
