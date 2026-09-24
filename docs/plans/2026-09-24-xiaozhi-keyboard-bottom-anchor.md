# Xiaozhi Keyboard Bottom Anchor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a bottom-following Xiaozhi conversation move its latest message, composer, and keyboard upward as one anchored unit.

**Architecture:** Keep React Native's iOS `KeyboardAvoidingView` height animation, but replace timing-based end scrolling during keyboard transitions with an explicit bottom-anchor transaction. Derive the exact list offset from measured content and viewport geometry, and preserve history mode unchanged.

**Tech Stack:** Expo 57.0.17, React Native 0.86.3, TypeScript, React Native `FlatList` and `Keyboard` APIs, Node assertion scripts.

---

### Task 1: Specify exact bottom geometry

**Files:**
- Modify: `src/assistant/ui-state.ts`
- Modify: `scripts/test-assistant-ui.ts`

1. Add failing cases for long content, short content, and invalid negative geometry.
2. Run `npm run test:assistant-ui` and verify the helper is missing.
3. Add a pure `assistantBottomOffset` helper returning `max(0, contentHeight - viewportHeight)`.
4. Rerun `npm run test:assistant-ui` and verify it passes.

### Task 2: Implement the keyboard anchor transaction

**Files:**
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `scripts/test-assistant-layout.cjs`

1. Add source-level regression assertions for keyboard-will-show snapshotting, exact-offset layout anchoring, final did-show settlement, and user-drag cancellation.
2. Run `npm run test:assistant-layout` and verify the new assertions fail.
3. Track keyboard anchor state separately from `following / history`.
4. On list layout, update measured viewport and scroll to the exact bottom offset only when the frozen keyboard anchor is following.
5. On keyboard completion, settle once without animation; reset stale drag state on focus and navigation focus.
6. Preserve history mode and existing shadow/jump-button calculations.
7. Rerun `npm run test:assistant-layout` and `npm run test:assistant-ui`.

### Task 3: Verify behavior and repository quality

**Files:**
- Modify if needed: `docs/knowledge/xiaozhi-mobile-composer-and-markdown.md`

1. Run `npm run test:assistant-composer`, `npm run test:assistant-markdown`, and `npm run typecheck`.
2. Run `npm run ci`.
3. Record the long-history keyboard-anchor regression and rollback scope in the existing knowledge topic.
4. Commit the reviewable change set, push the branch, and create a PR against `main`.
5. Deliver to the Dev app and verify the reference-video motion from Home → Xiaozhi before any Release rebuild.

