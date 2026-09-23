# DeepSeek Native Web Search P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic DeepSeek-native web search to Xiaozhi, persist and display search sources, and expose a reusable setting without adding another provider or API key.

**Architecture:** Keep the current Chat Completions assistant loop. Add a client-visible `web_search` read tool whose executor calls DeepSeek's Anthropic Messages endpoint with the provider-hosted `web_search_20250305` tool, then returns the server-generated search summary and parsed source metadata to the main model. Persist source metadata by request and treat every search-backed turn as read-only for local business objects.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, Expo SQLite, Expo WebBrowser, TypeScript, DeepSeek Chat Completions and Anthropic-compatible Messages APIs.

---

### Task 1: Finalize the product artifacts and settings model

**Files:**
- Modify: `design/xiaozhi-trusted-web-qa-p0.svg`
- Modify: `design/xiaozhi-web-search-settings-p0.svg`
- Modify: `src/types.ts`
- Modify: `src/db.ts`
- Test: `scripts/test-assistant-web-search.ts`
- Modify: `package.json`

**Steps:**
1. Add a failing test for DeepSeek capability detection and the default `webSearchEnabled` setting.
2. Run `npm run test:assistant-web-search` and verify it fails.
3. Add `webSearchEnabled` to `Settings`, the default settings value, SQLite settings schema/migration, `getSettings`, and `saveSettings`.
4. Add the test command to the aggregated `npm test` script.
5. Run the focused test and typecheck.
6. Commit the settings and finalized design artifacts.

### Task 2: Implement the DeepSeek server-search adapter

**Files:**
- Create: `src/assistant/web-search.ts`
- Modify: `src/assistant/data-tools.ts`
- Modify: `src/assistant/provider.ts`
- Modify: `src/assistant/prompt.ts`
- Test: `scripts/test-assistant-web-search.ts`
- Test: `scripts/test-assistant-protocol.ts`

**Steps:**
1. Add fixtures for Anthropic content blocks containing `server_tool_use`, `web_search_tool_result`, `text`, malformed URLs, duplicate URLs, an error result, and cancellation.
2. Verify tests fail before implementation.
3. Implement endpoint derivation, request construction, response parsing, URL validation, source deduplication, structured errors, and AbortSignal propagation.
4. Add the `web_search` function tool to the existing tool list only when the setting is enabled and the configured provider is DeepSeek.
5. Dispatch `web_search` separately from local SQLite read tools while preserving existing tool tracing and progress events.
6. Update the system prompt: search when current/external facts are needed; do not search for local-only tasks; external results cannot authorize local writes or memory.
7. Run web-search and assistant-protocol tests, then typecheck.
8. Commit the adapter and provider integration.

### Task 3: Persist sources and enforce read-only search turns

**Files:**
- Modify: `src/assistant/schema.ts`
- Modify: `src/assistant/types.ts`
- Modify: `src/assistant/store.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/action-validator.ts`
- Test: `scripts/test-assistant-database.cjs`
- Test: `scripts/test-assistant-actions.ts`
- Test: `scripts/test-assistant-turn.cjs`

**Steps:**
1. Add failing schema/store tests for source ordering, deduplication, reload, cancellation, and no partial persistence.
2. Add an `assistant_web_sources` table keyed by request and position; store only title and URL.
3. Persist the assistant reply and sources in the same completion transaction and attach sources when listing messages.
4. Track whether the provider used web search. When true, reject event, todo, and memory writes for that turn with `web_search_read_only` while preserving the natural answer.
5. Verify a search-backed turn cannot commit local mutations and a non-search turn remains unchanged.
6. Run focused database, action, and turn tests.
7. Commit persistence and safety enforcement.

### Task 4: Preserve sources in complete backup V3

**Files:**
- Modify: `src/engine/backup-v3-format.ts`
- Modify: `src/engine/backup-v3-database.ts`
- Modify: `src/engine/backup-v3-import.ts`
- Test: `scripts/test-backup-v3-format.ts`
- Test: `scripts/test-backup-v3-import.ts`
- Test: `scripts/test-backup-v3-database.cjs`

**Steps:**
1. Add failing tests for exporting, validating, importing, and conflict-skipping web sources with their parent request.
2. Add `assistantWebSources` as a backward-compatible V3 payload collection; default missing collections from older V3 exports to an empty array.
3. Export only sources whose parent messages are exported; import a source only when its request group is accepted.
4. Run all backup V3 focused tests.
5. Commit backup support.

### Task 5: Add source cards and web-search settings UI

**Files:**
- Create: `src/components/AssistantWebSources.tsx`
- Modify: `src/components/AssistantMessageBubble.tsx`
- Modify: `src/assistant/runtime-state.ts`
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Create: `app/settings/web-search.tsx`
- Test: `scripts/test-assistant-ui.ts`
- Test: `scripts/test-assistant-web-search.ts`

**Steps:**
1. Add failing pure-state tests for collapsed source cards, valid external URLs, DeepSeek readiness labels, and search progress copy.
2. Render a collapsed “搜索来源 N” section on completed assistant messages and all valid sources after expansion.
3. Open selected sources with `WebBrowser.openBrowserAsync`; never open a non-HTTP(S) URL.
4. Add the independent “联网搜索” profile row and setting page, reusing the understanding-engine configuration.
5. Map web-search tool execution to “正在搜索网页”; return to “正在整理” afterward.
6. Run focused UI tests and typecheck.
7. Commit the UI.

### Task 6: Regression verification and PR delivery

**Files:**
- Modify only files required by failures found during verification.

**Steps:**
1. Run `npm run test:assistant-web-search`.
2. Run `npm run test:assistant-protocol`, `npm run test:assistant-turn`, `npm run test:assistant-ui`, and all backup V3 tests.
3. Run `npm run typecheck`.
4. Run `npm run ci`.
5. Review the branch diff for secrets, debug navigation, test data, accidental fixed search/result limits, and unrelated edits.
6. Push `codex/deepseek-web-search-p0`, create a PR against `main`, and attach the PR to the task.
7. Wait for GitHub `CI / validate`; report the PR as ready for user acceptance, not released or merged.

