# Card Width and Memory Heading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Match the home todo card width to the event card and rebalance long-term memory category icons and headings.

**Architecture:** Keep the existing components, content, navigation, and persistence unchanged. Limit the implementation to React Native style constants in the home screen and `MemorySection`, then verify through static checks, TypeScript, the full CI suite, and a physical-device Dev build.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Expo Router.

---

## Confirmed design

- Give `todoCard` the same `marginHorizontal: -8` used by `eventCard`, so both cards share identical left and right edges.
- Reduce the memory category icon container from 38 to 34 points and its glyph from 21 to 18 points.
- Increase memory category headings from 14 to 16 points with a 22-point line height.
- Reduce the category/body offset from 48 to 44 points so memory content stays aligned below the heading after the icon is reduced.
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
2. Change the memory category glyph size to 18.
3. Change `memoryIcon` to 34 × 34 with a proportionate radius.
4. Change `category` to 16/22 while keeping the existing weight and color.
5. Change `memoryBody` left margin to 44.

### Task 2: Verify and deliver Dev acceptance

**Files:**
- Verify: `app/(tabs)/index.tsx`
- Verify: `src/components/MemorySection.tsx`

1. Run focused TypeScript validation.
2. Run `npm run ci`.
3. Commit the design and implementation on the dedicated branch.
4. Push and create a new pull request.
5. Follow the documented Dev device flow and load the branch on the connected iPhone.
