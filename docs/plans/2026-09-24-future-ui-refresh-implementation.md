# Future UI Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle Home, Xiaozhi, and Profile with the approved light ambient-intelligence visual system without changing product modules or data behavior.

**Architecture:** Extend the shared theme with semantic surface, ink, graphite, and ambient-line tokens, then restyle existing screens and components in place. Keep stores, queries, navigation targets, state machines, and component contracts unchanged; add only a passive decorative background component shared by the three tabs.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TypeScript, React Native Reanimated (existing usage only)

---

### Task 1: Lock visual invariants and shared primitives

**Files:**
- Create: `src/components/AmbientOrbit.tsx`
- Modify: `src/theme.ts`
- Modify: `scripts/test-assistant-layout.cjs`

**Step 1:** Add failing source assertions for the semantic fog/ink tokens, passive ambient orbit, neutral inactive tabs, and absence of a central hero/mascot block in the Xiaozhi page.

**Step 2:** Run `npm run test:assistant-layout` and confirm the new assertions fail.

**Step 3:** Add the theme tokens and a pointer-events-disabled `AmbientOrbit` made from clipped, hairline React Native views. It must not animate, affect layout, or add dependencies.

**Step 4:** Run `npm run test:assistant-layout` and confirm the shared-primitive assertions pass.

**Step 5:** Commit the shared visual foundation.

### Task 2: Restyle Home and Profile without changing modules

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Modify: `src/components/AssistantEventCard.tsx`
- Modify: `src/components/MemorySection.tsx`
- Modify: `src/components/CalendarSyncSetting.tsx`

**Step 1:** Add source assertions that Home retains only the existing date/todo/event modules and Profile retains the current memory/settings groups.

**Step 2:** Run the focused UI/layout tests and confirm only the new visual assertions fail.

**Step 3:** Replace repeated bordered cards with editorial rows, hairline separators, numbered memory items, and quiet grouped settings. Preserve every handler, route, accessibility label, state branch, and minimum touch target.

**Step 4:** Run `npm run test:assistant-layout`, `npm run test:assistant-ui`, and `npm run test:assistant-memory-ui`.

**Step 5:** Commit the Home/Profile visual pass.

### Task 3: Restyle Xiaozhi and navigation while preserving keyboard behavior

**Files:**
- Modify: `app/(tabs)/assistant.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/components/AssistantComposer.tsx`
- Modify: `src/components/AssistantMessageBubble.tsx`
- Modify: `src/components/AssistantEmptyState.tsx`
- Modify: `src/components/XiaozhiEyesIcon.tsx`
- Modify: `scripts/test-assistant-layout.cjs`

**Step 1:** Update the focused layout assertions to require the new surfaces while retaining every keyboard, scrolling, Markdown, safe-link, and tab-background invariant.

**Step 2:** Run `npm run test:assistant-layout` and confirm the visual assertions fail while existing behavioral assertions remain meaningful.

**Step 3:** Add the passive orbit behind the header/message area, move the small eye signature into the header/composer system, use a compact ink user bubble, and restyle the composer/navigation. Do not move the keyboard stage, composer absolute layer, list footer, or scrolling callbacks.

**Step 4:** Run `npm run test:assistant-layout`, `npm run test:assistant-ui`, `npm run test:assistant-composer`, and `npm run test:assistant-markdown`.

**Step 5:** Commit the Xiaozhi/navigation visual pass.

### Task 4: Verify, publish PR, and prepare Dev acceptance

**Files:**
- Modify only if verification reveals a scoped regression.

**Step 1:** Run `npm run typecheck`.

**Step 2:** Run `npm run ci`.

**Step 3:** Review the full branch diff for accidental product, data, navigation, or native changes.

**Step 4:** Push the branch, open the PR, attach it to the task, and wait for GitHub `CI / validate`.

**Step 5:** Confirm the active 8081 Metro owner and transport, start the target branch with `npm run start:dev`, open the resulting tunnel URL on the physical iPhone Dev app, and verify a post-launch iOS bundle completes.

**Step 6:** Ask the user to accept Home, Xiaozhi, and Profile on device. Do not merge before acceptance.

