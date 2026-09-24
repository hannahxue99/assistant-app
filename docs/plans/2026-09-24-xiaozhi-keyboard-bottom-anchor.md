# Xiaozhi Keyboard Bottom Anchor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a bottom-following Xiaozhi conversation move its latest message, composer, and keyboard upward as one anchored unit.

**Architecture:** Keep the header fixed. Subscribe to the native keyboard's real-time height through the already-installed Reanimated runtime and derive one shared lift value. The root composer always consumes it; the message stage consumes the same value only in following mode, so history mode leaves message pixels fixed.

**Tech Stack:** Expo 57.0.17, React Native 0.86.3, TypeScript, React Native `FlatList` and `Keyboard` APIs, Node assertion scripts.

---

### Task 1: Preserve the existing conversation state machine

**Files:**
- Modify: `src/assistant/ui-state.ts`
- Modify: `scripts/test-assistant-ui.ts`

1. Keep `following / history` as the only scroll intent state.
2. Preserve the measured footer, prepend compensation, shadow, and jump-to-latest behavior.
3. Verify history focus never invokes `scrollToEnd`.

### Task 2: Implement one real-time keyboard timeline

**Files:**
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `scripts/test-assistant-layout.cjs`

1. Add source-level regression assertions for one shared native keyboard value, the fixed header, shared following stage, and composer-only history stage.
2. Run `npm run test:assistant-layout` and verify the new assertions fail.
3. Measure the closed composer bottom gap once and derive `keyboardLift` from the real-time native keyboard height.
4. Apply the same Shared Value to the message stage and composer in `following`.
5. Apply it only to the root-level composer in `history`; freeze the mode on input focus.
6. Clip the moving conversation stage at the fixed header boundary and remove every independent keyboard layout/timing animation.
7. Preserve history mode and existing shadow/jump-button calculations.
8. Rerun `npm run test:assistant-layout` and `npm run test:assistant-ui`.

### Task 3: Verify behavior and repository quality

**Files:**
- Modify if needed: `docs/knowledge/xiaozhi-mobile-composer-and-markdown.md`

1. Run `npm run test:assistant-composer`, `npm run test:assistant-markdown`, and `npm run typecheck`.
2. Run `npm run ci`.
3. Record the long-history keyboard-anchor regression and rollback scope in the existing knowledge topic.
4. Commit the reviewable change set, push the branch, and create a PR against `main`.
5. Deliver to the Dev app and verify the reference-video motion from Home → Xiaozhi before any Release rebuild.
