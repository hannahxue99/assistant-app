# 长期记忆与“我的”页面 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立小知长期记忆的候选—生效—替代—忘记闭环，并把“我的”改造成以长期记忆为主体的完整页面。

**Architecture:** 记忆判断复用现有小知单次模型请求，通过独立的 `memory_deltas` 协议输出；本地负责证据、状态、版本、隐私与重复准入校验。记忆、来源、回复、待办和事件在同一 SQLite 独占事务提交，并复用现有操作回执与整轮撤销；“我的”只读取 active 记忆，页面编辑和忘记不调用模型。

**Tech Stack:** Expo SDK 57、Expo Router 57、React Native 0.86、TypeScript 6、expo-sqlite 57、Node/tsx 测试脚本。

---

### Task 1: 冻结设计与数据库迁移契约

**Files:**
- Modify: `docs/plans/2026-09-15-long-term-memory-design.md`
- Create: `docs/plans/2026-09-15-long-term-memory-implementation.md`
- Create: `src/assistant/memory-schema.ts`
- Create: `src/assistant/memory-types.ts`
- Modify: `src/assistant/action-schema.ts`
- Modify: `src/db.ts`
- Create: `scripts/test-assistant-memory-database.cjs`
- Modify: `package.json`

**Steps:**

1. 写数据库测试，覆盖新库建表、旧 `assistant_operations` CHECK 约束迁移、旧操作行数保持和重复启动幂等。
2. 运行 `npm run test:assistant-memory-db`，确认因表和迁移函数不存在而失败。
3. 新增 `assistant_memories`、`assistant_memory_sources` 表、索引与 TypeScript 类型。
4. 事务化重建旧 `assistant_operations`，加入四类记忆操作和 `memory` 对象类型；复制后校验行数再替换。
5. 在 `initDatabase` 接入记忆 schema 和迁移。
6. 把新测试注册进 `npm test`，运行数据库测试确认通过。

### Task 2: 记忆仓储、旧画像迁移与页面直接操作

**Files:**
- Create: `src/assistant/memory-store.ts`
- Create: `src/assistant/memory-migration.ts`
- Create: `src/assistant/memory-policy.ts`
- Create: `scripts/test-assistant-memory.ts`
- Modify: `package.json`

**Steps:**

1. 写失败测试：active/candidate 分级读取、来源去重、内容规范化、敏感凭证拒绝、修改建立新版本、忘记与撤销、revision 冲突。
2. 实现记忆 CRUD、来源关联、确定性 ID、页面编辑/忘记撤销 token 和并发保护。
3. 实现旧画像幂等迁移：`avoid` 转 active 偏好，`goals` 转隐藏 candidate，保留原 profile 表。
4. 运行记忆仓储测试并确认全部通过。

### Task 3: 模型协议、准入校验与上下文预算

**Files:**
- Modify: `src/assistant/protocol.ts`
- Modify: `src/assistant/prompt.ts`
- Modify: `src/assistant/context.ts`
- Create: `src/assistant/memory-context.ts`
- Create: `src/assistant/memory-validator.ts`
- Modify: `scripts/test-assistant-protocol.ts`
- Modify: `scripts/test-assistant-context.ts`
- Modify: `scripts/test-assistant-memory.ts`

**Steps:**

1. 写失败测试，覆盖 `memory_deltas` 五种动作、最多两条、本地稳定 key、非法字段和缺证据拒绝。
2. 扩展系统提示词，使模型区分长期记忆、临时状态、事件与待办，并禁止从助手文字提取证据。
3. 实现 active 最多 12 条/约 800 tokens、candidate 最多 3 条的相关性选择和上下文渲染。
4. 实现异步本地校验：证据必须来自本轮用户原话；目标 ID/revision 必须命中候选；重复生效需要不同消息来源；敏感内容不得靠重复生效；忘记墓碑不得被推断恢复。
5. 运行协议、上下文和记忆策略测试。

### Task 4: 原子执行、回执、决策日志与整轮撤销

**Files:**
- Modify: `src/assistant/action-types.ts`
- Modify: `src/assistant/action-store.ts`
- Modify: `src/assistant/action-undo.ts`
- Modify: `src/assistant/orchestrator.ts`
- Modify: `src/assistant/decision-log.ts`
- Modify: `src/assistant/ui-state.ts`
- Modify: `src/components/AssistantActionReceipt.tsx`
- Modify: `scripts/test-assistant-actions.ts`
- Modify: `scripts/test-assistant-actions-database.cjs`
- Modify: `scripts/test-assistant-ui.ts`
- Modify: `scripts/test-assistant-turn.cjs`

**Steps:**

1. 写失败测试：同轮记忆/待办/事件原子提交、合并回执、重复请求幂等、记忆提交失败不出现成功回复。
2. 把通过校验的记忆增量接入现有独占事务，写入操作日志与来源。
3. 扩展回执图标、文案与“我的”跳转；candidate 不显示回执，active/替代/忘记显示。
4. 扩展整轮撤销，按最终 revision 防止覆盖更新后的记忆。
5. 在决策日志加入 proposed memory deltas、候选引用、校验和拒绝原因。
6. 运行动作、事务、UI 和整轮测试。

### Task 5: 完整“我的”页面

**Files:**
- Create: `src/components/MemoryCard.tsx`
- Create: `src/components/MemorySection.tsx`
- Modify: `src/components/CalendarSyncSetting.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Create: `scripts/test-memory-ui.ts`
- Modify: `package.json`

**Steps:**

1. 写状态测试：首次骨架、active 列表、空态、局部错误、原地编辑、忘记与撤销、revision 冲突提示。
2. 将页头改为“我的”，摘要显示陪伴天数和 active 记忆数，移除旧画像卡。
3. 按确认设计实现长期记忆主区、助手与同步、待办通知、数据管理和数据概览。
4. 保持整页滚动与 Tab 固定；重新聚焦保留旧内容，在后台刷新且不重置滚动位置。
5. 补齐 accessibility label、44pt 点击区、键盘与 VoiceOver 顺序。
6. 运行页面状态测试和 TypeScript 检查。

### Task 6: 备份、导入与回归验证

**Files:**
- Modify: `src/types.ts`
- Modify: `src/engine/backup-format.ts`
- Modify: `src/engine/import-merge.ts`
- Modify: `src/db.ts`
- Modify: `scripts/test-backup-format.ts`
- Modify: `scripts/test-import-merge.ts`
- Modify: `scripts/test-database-runtime.ts`

**Steps:**

1. 写失败测试：新版记忆与来源往返、旧 V2 备份缺少记忆字段仍能导入、记忆 ID/revision 合并幂等。
2. 在保持 V2 旧备份兼容的前提下，把 `memories` 和 `memorySources` 作为可选扩展字段加入数据胶囊。
3. 导入时按 ID、revision、updatedAt 保守合并；不得把候选误升级为 active。
4. 可读 Markdown 增加“长期记忆”章节，但不输出来源证据。
5. 运行备份、导入和数据库运行时测试。

### Task 7: 全量验证、提交、PR 与真机交付

**Files:**
- Modify: `docs/quality/xiaozhi-multiturn-fixtures.md`
- Create after acceptance: `docs/knowledge/long-term-memory.md`
- Modify after acceptance: `docs/knowledge/INDEX.md`

**Steps:**

1. 运行新增测试、相关回归测试和 `npm run ci`。
2. 执行 `git diff --check` 并复核没有原生依赖、权限或 Bundle ID 变化。
3. 分阶段提交到现有 `codex/xiaozhi-todos-events` 分支，推送并更新 PR #19。
4. 向现有 Metro Dev 会话发送一次 Reload，不新开 Metro。
5. 真机验收：明确记住、候选隐藏、重复生效、纠正替代、对话忘记、页面修改/忘记/撤销、重启恢复、导出导入。
6. 用户验收后补知识文档、回滚点与发布记录；未经接受不合并 PR。
