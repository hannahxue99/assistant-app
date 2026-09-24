# Card Width and Memory Heading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Match the home todo card width to the event card and rebalance long-term memory category icons and headings.

**Architecture:** Keep the existing components, content, navigation, and persistence unchanged. Limit the implementation to React Native style constants in the home screen and `MemorySection`, then verify through static checks, TypeScript, the full CI suite, and a physical-device Dev build.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Expo Router.

---

## Confirmed design

- Give `todoCard` the same `marginHorizontal: -8` used by `eventCard`, so both cards share identical left and right edges.
- Match the memory category icon to setting rows: a 32-point container, 12-point radius, and 19-point glyph.
- Match memory category headings to the setting-row body font size while preserving their orange color and bold weight.
- Match the memory card's 14-point horizontal padding to setting rows and use a 42-point body offset so headings, icons, and content share the same left grid.
- Preserve card height, padding, colors, shadows, actions, data flow, edit behavior, and empty/loading/error states.

## Acceptance criteria

1. Home todo and event cards have identical horizontal edges.
2. “偏好”, “长期目标”, and every other memory category use the same larger heading treatment.
3. The category glyph is visually subordinate to the heading and remains vertically centered.
4. Memory content and editor align consistently with the adjusted category row.
5. No persistence, navigation, native configuration, or database behavior changes.
6. TypeScript and `npm run ci` pass; the Dev build loads on the connected iPhone for acceptance.

### Task 1: Apply the visual refinements

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `src/components/MemorySection.tsx`

1. Add `marginHorizontal: -8` to `todoCard`.
2. Change the memory category glyph size to 19.
3. Change `memoryIcon` to 32 × 32 with the same 12-point radius used by setting rows.
4. Change `category` to `theme.font.body` while keeping the existing weight and color.
5. Match memory-card horizontal padding to setting rows and change `memoryBody` left margin to 42.

### Task 2: Verify and deliver Dev acceptance

**Files:**
- Verify: `app/(tabs)/index.tsx`
- Verify: `src/components/MemorySection.tsx`

1. Run focused TypeScript validation.
2. Run `npm run ci`.
3. Commit the design and implementation on the dedicated branch.
4. Push and create a new pull request.
5. Follow the documented Dev device flow and load the branch on the connected iPhone.
