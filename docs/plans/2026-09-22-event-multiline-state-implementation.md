# Event Multiline State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve readable multiline event state while keeping protocol validation, storage limits, and Node-based tests reliable.

**Architecture:** Put newline and whitespace normalization in a native-free pure TypeScript module. Protocol parsing reuses it and rejects over-limit model output; event persistence reuses it and defensively truncates internal writes. Tests import only the pure module and the existing protocol surface.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 6, expo-sqlite, tsx test scripts.

---

### Task 1: Record the approved design separately

**Files:**
- Add: `docs/plans/2026-09-22-event-multiline-state-design.md`
- Add: `docs/plans/2026-09-22-event-multiline-state-implementation.md`

**Step 1:** Mark the recommended pure-module design as approved.

**Step 2:** Commit only the two plan files.

Run: `git status --short`

Expected: the six historical SVG files remain untracked and are not staged.

### Task 2: Add a native-free multiline normalizer

**Files:**
- Create: `src/assistant/text-normalization.ts`
- Modify: `scripts/test-assistant-protocol.ts:14,153-157`

**Step 1:** Change the regression test to import `normalizeMultilineText` from the pure module and cover CRLF, lone CR, line-edge whitespace, repeated blank lines, list markers, and empty input.

**Step 2:** Run `npm run test:assistant-protocol`.

Expected: FAIL because the new module does not exist yet.

**Step 3:** Implement:

```ts
export function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

**Step 4:** Run `npm run test:assistant-protocol`.

Expected: existing protocol assertions and the new normalization assertions pass without loading React Native.

### Task 3: Reuse the normalizer in protocol and persistence

**Files:**
- Modify: `src/assistant/protocol.ts:75-95`
- Modify: `src/assistant/event-store.ts:22-34,90-100,140-151`
- Test: `scripts/test-assistant-protocol.ts`

**Step 1:** Import `normalizeMultilineText` in both modules.

**Step 2:** Remove duplicated multiline normalization code.

**Step 3:** Keep protocol overflow behavior as rejection after normalization.

**Step 4:** Add a local event-store helper that normalizes then truncates to the supplied storage limit.

**Step 5:** Run `npm run test:assistant-protocol` and `npm run typecheck`.

Expected: both pass in a clean generated-type environment.

### Task 4: Verify the complete gate

**Files:**
- Inspect only: `.expo/types/router.d.ts`

**Step 1:** If ignored route types are stale, move the generated cache to a recoverable temporary location; do not edit tracked source to silence it.

**Step 2:** Run `npm run ci`.

Expected: typecheck and every command registered under `npm test` pass.

**Step 3:** Confirm `npx expo install --check` reports the Expo SDK 57 dependency set as compatible.

### Task 5: Deliver through the existing feature branch

**Files:**
- Update: `docs/plans/2026-09-22-event-multiline-state-design.md`

**Step 1:** Merge the latest `origin/main` into `codex/event-multiline-state` without discarding history.

**Step 2:** Commit implementation and verification documentation.

**Step 3:** Push the branch and create a PR targeting `main`.

**Step 4:** Verify GitHub `CI / validate` passes.

**Step 5:** Report that this JavaScript-only change is ready for Metro Reload acceptance; do not merge until the user accepts it.

