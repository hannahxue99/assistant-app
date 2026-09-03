# Design System and Component Preview Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立可执行的项目设计系统和开发态组件预览页，并让聚合卡图钉与确认稿保持同源、同方向。

**Architecture:** 设计令牌继续集中在 `src/theme.ts`，新增文档描述令牌和组件约束。通用 `TopicPinIcon` 封装平台符号、状态和固定方向，业务页与组件预览页共用；预览页仅在开发环境从“我的”页进入，避免污染正式产品信息架构。

**Tech Stack:** Expo 57、React Native 0.86、Expo Router、expo-symbols、TypeScript。

---

### Task 1: 固化设计令牌与规范

**Files:**
- Create: `DESIGN_SYSTEM.md`
- Modify: `src/theme.ts`

**Steps:**
1. 补齐 spacing、touch target 和字体权重令牌。
2. 记录颜色、文字、圆角、交互状态、图标来源及视觉验收规则。
3. 运行 `npm run typecheck`，预期通过。

### Task 2: 建立统一图钉组件

**Files:**
- Create: `src/components/TopicPinIcon.tsx`
- Modify: `app/(tabs)/index.tsx`

**Steps:**
1. 用 `expo-symbols` 的 `pin` / `pin.fill` 封装选中与未选中状态。
2. 固定旋转 45°，最终视觉为钉帽右上、钉尖左下。
3. 首页聚合卡只调用共享组件，不再自行选择或旋转图标。
4. 运行 `npm run typecheck`，预期通过。

### Task 3: 新增开发态组件预览页

**Files:**
- Create: `app/design-system.tsx`
- Modify: `app/(tabs)/profile.tsx`

**Steps:**
1. 展示核心颜色、文字层级、按钮、编辑入口和聚合卡图钉双状态。
2. 在 `__DEV__` 下从“我的”页提供“组件预览”入口。
3. 页面只消费正式令牌和共享组件，禁止复制一套演示样式源。
4. 运行 `npm run typecheck`，预期通过。

### Task 4: 同步设计稿和知识沉淀

**Files:**
- Modify: `design/topic-actions.svg`
- Modify: `docs/knowledge/topic-actions.md`

**Steps:**
1. 将设计稿两个图钉水平翻转为钉帽右上、钉尖左下。
2. 记录“设计稿—共享组件—业务页面”的单一来源原则。
3. 真机验收未置顶、已置顶、点击区域与卡片高度。

### Task 5: 回归与 PR

**Steps:**
1. 运行 TypeScript、主题排序、通知、日程、时间解析测试。
2. 检查 Git diff 和文档一致性。
3. 提交分支并创建以 `feat/topic-pin-rename-polish` 为基线的叠加 PR。
