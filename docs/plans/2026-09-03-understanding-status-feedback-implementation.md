# Understanding Status Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在聚合消息页准确呈现“正在整理”和“理解失败”，支持单条重试与批量异常提示，同时不展示仅本地规则状态。

**Architecture:** 复用现有 `parse_status`：`pending` 表示 LLM 处理中、`ok` 表示成功或纯规则、`failed` 表示 LLM 失败。首页仅在理解引擎已启用时消费 `pending/failed`；成功记录自然进入主题聚合，纯规则模式保持现有界面。

**Tech Stack:** Expo 57、React Native、TypeScript、SQLite、OpenAI 兼容 LLM API。

---

### Task 1: 状态规则与测试

**Files:**
- Create: `src/engine/understanding-feedback.ts`
- Create: `scripts/test-understanding-feedback.ts`
- Modify: `package.json`

**Steps:**
1. 写测试覆盖最近 10 分钟至少 3 条失败、失败不足 3 条、旧失败不触发。
2. 实现纯函数 `shouldShowUnderstandingFailureBanner`。
3. 运行测试，预期全部通过。

### Task 2: 正确写入处理状态与超时

**Files:**
- Modify: `src/db.ts`
- Modify: `src/engine/understand.ts`
- Modify: `src/engine/llm.ts`

**Steps:**
1. LLM 调用开始前将记录标记为 `pending`。
2. 成功写回 `ok`，失败降级后写回 `failed`。
3. 为理解请求增加 30 秒超时，避免永久停留“正在整理”。
4. 启动时继续重试失败记录。

### Task 3: C 端状态反馈

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Steps:**
1. `pending` 原文显示“正在整理…”。
2. `failed` 原文显示“原文已保存，暂未整理”和“重试”。
3. 最近 10 分钟至少 3 条失败时显示页面级提示和“检查设置”。
4. LLM 关闭或 Key 缺失时不展示任何状态提示。

### Task 4: 文档、回归与 PR

**Files:**
- Modify: `DESIGN_SYSTEM.md`
- Modify: `TESTCASES.md`
- Create: `docs/knowledge/understanding-status.md`
- Modify: `docs/knowledge/INDEX.md`

**Steps:**
1. 同步状态文案、触发条件与经验。
2. 运行类型检查及全部回归测试。
3. 提交独立分支并创建 GitHub PR。
