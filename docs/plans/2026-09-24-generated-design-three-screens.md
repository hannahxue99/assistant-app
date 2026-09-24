# Generated Design Three Screens Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Faithfully implement the three generated UI references for Home, Profile, and Xiaozhi without changing product behavior.

**Architecture:** Keep existing screens as data and interaction owners, add small reusable visual primitives for the warm ambient background and Xiaozhi mascot, and centralize shared tokens in the theme. Static reference images remain design documentation; the app consumes only the optimized mascot asset.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TypeScript, static PNG assets, existing SQLite and assistant modules.

---

### Task 1: Preserve the source-of-truth visual references

**Files:**
- Create: `docs/plans/generated-design-reference/home.png`
- Create: `docs/plans/generated-design-reference/profile.png`
- Create: `docs/plans/generated-design-reference/assistant.png`
- Create: `assets/images/xiaozhi-mascot.png`

**Steps:** Copy the three downloaded originals into the plan folder, derive one transparent reusable mascot asset, inspect all images, then commit the design and assets.

### Task 2: Add shared visual primitives and regression checks

**Files:**
- Modify: `src/theme.ts`
- Create: `src/components/WarmAmbientBackground.tsx`
- Create: `src/components/XiaozhiMascot.tsx`
- Modify: `scripts/test-assistant-layout.cjs`

**Steps:** Add failing source-level assertions for shared primitives and page markers, run `npm run test:assistant-layout`, implement the minimal components/tokens, rerun the test, then commit.

### Task 3: Rebuild Home from the generated reference

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Test: `scripts/test-assistant-layout.cjs`

**Steps:** Preserve existing loading and actions, replace the view hierarchy with greeting, grouped todo list, highlighted watching card and recent-event list, run layout tests and typecheck, then commit.

### Task 4: Rebuild Profile from the generated reference

**Files:**
- Modify: `app/(tabs)/profile.tsx`
- Modify: `src/components/MemorySection.tsx`
- Test: `scripts/test-assistant-layout.cjs`

**Steps:** Preserve all memory/settings handlers, restyle the header, memory cards and settings groups, verify edit/delete/undo markers remain, run focused tests and typecheck, then commit.

### Task 5: Rebuild Xiaozhi from the generated reference

**Files:**
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `src/components/AssistantMessageBubble.tsx`
- Modify: `src/components/AssistantComposer.tsx`
- Test: `scripts/test-assistant-layout.cjs`
- Test: `scripts/test-assistant-composer.ts`

**Steps:** Preserve the current keyboard/scroll/message pipeline, apply the generated card hierarchy and header, run assistant layout/composer/markdown/UI tests and typecheck, then commit.

### Task 6: Unify tab navigation and verify the full change

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `package.json` only if a new test command is required, and ensure it is included by `npm test`.

**Steps:** Match the reference tab bar, run focused checks, run `npm run ci`, inspect the final diff, push the branch, create a new PR against `main`, attach it, and wait for GitHub `CI / validate`.

