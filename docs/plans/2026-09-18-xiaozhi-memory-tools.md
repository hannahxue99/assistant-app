# Xiaozhi Memory Read Tools Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add model-controlled, read-only long-term-memory tools while preserving strict local authorization and validation for all memory mutations.

**Architecture:** Extend the existing assistant data-tool loop with `search_memories` and `get_memory`. Exact reads contribute memory IDs to the grounded read set; the orchestrator loads those database rows into the existing memory validator context. Search results remain discovery-only. Decision logging records exact memory reads, and memory preloading excludes zero-relevance rows.

**Tech Stack:** Expo 57, TypeScript, expo-sqlite, DeepSeek-compatible chat completions, Node test scripts.

---

### Task 1: Specify memory-tool authorization in tests

**Files:**
- Modify: `scripts/test-assistant-data-tools.ts`
- Modify: `scripts/test-assistant-data-tools-database.cjs`
- Modify: `scripts/test-assistant-protocol.ts`

1. Add failing tests proving search returns candidates without `readMemoryIds`.
2. Add failing tests proving exact get returns the full record and authorizes only that ID.
3. Add failing protocol tests proving both tools are exposed.
4. Run the focused tests and confirm failure.

### Task 2: Implement read-only memory tools

**Files:**
- Modify: `src/assistant/data-tools.ts`

1. Extend tool names, schemas, executions, and merged read sets with memory IDs.
2. Implement status-aware memory search using escaped SQL matching.
3. Implement exact memory lookup with real status, revision, and timestamps.
4. Run focused data-tool tests.

### Task 3: Ground memory mutations in exact reads

**Files:**
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/memory-store.ts`
- Modify: `src/assistant/working-snapshots.ts`
- Modify: `scripts/test-assistant-turn.cjs`

1. Add a database helper that loads memory rows by exact IDs.
2. Union preselected relevant memory IDs with exact tool reads for validation.
3. Cache exact reads inside the current segment and invalidate them by database revision.
4. Add turn tests: exact get permits a valid forget delta; search-only does not; valid snapshots are reused.
5. Confirm strict missing-field behavior remains unchanged.

### Task 4: Stop injecting unrelated active memories

**Files:**
- Modify: `src/assistant/memory-context.ts`
- Modify: `scripts/test-assistant-memory.ts`

1. Add a failing test for a zero-relevance active memory.
2. Filter zero-relevance active memories before ranking and budgeting.
3. Verify relevant active memories and candidates still load.

### Task 5: Add auditable memory-read logging

**Files:**
- Modify: `src/assistant/action-schema.ts`
- Modify: `src/db.ts`
- Modify: `src/assistant/decision-log.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`

1. Add and migrate `tool_read_memory_ids_json`.
2. Reset, record, and expose the field in decision logs.
3. Assert schema and round-trip behavior in database tests.

### Task 6: Verify and deliver to the existing PR

**Files:**
- Modify as needed from failures.

1. Run focused tests.
2. Run `npm run ci` with the supported Node runtime.
3. Commit to `codex/xiaozhi-grounded-tools` and push PR #22.
4. Wait for required GitHub checks.
5. Reload the existing Dev Metro session for phone acceptance.
