# Xiaozhi Continuous Conversation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在第一张可审查 PR 中交付“小知”连续对话页、可靠消息保存和可测试的多轮上下文组装，为后续事件、待办、记忆和教练提醒接入建立稳定底座。

**Architecture:** 保留现有 Expo Router + SQLite 本地优先架构。消息先落库，再由上下文选择器从最近原话、滚动分段摘要和旧记录检索结果中构造有上限的上下文；一次 OpenAI 兼容调用返回自然回复与分段元数据，本地使用请求 ID 和独占事务保存结果。第一张 PR 不删除首页现有输入，不暴露尚未实现的对象操作，避免半成品覆盖现有可用能力。

**Tech Stack:** Expo SDK 57、React Native 0.86、Expo Router、expo-sqlite、TypeScript、现有 OpenAI 兼容 LLM 设置、Node/tsx 测试脚本。

---

## 交付边界

本 PR 包含：

- 底部新增“小知”Tab，普通进入安静展示连续历史。
- 用户和助手消息完整本地保存，旧 `entries` 原声幂等投影为历史用户消息。
- 最近消息分页加载、发送中状态、失败重试、键盘与语音输入。
- 最近 6 轮原话 + 当前段摘要 + 最多 3 个相关历史段 + 最多 5 条相关旧记录的上下文包。
- 上下文 Token 预算、检索排序、冲突优先级和调试日志中的安全统计。
- 模型结构化返回：自然回复、是否切换话题、可选滚动摘要；不执行待办 / 事件 / 记忆操作。
- 请求幂等、失败保留用户消息、成功后事务保存助手回复和分段状态。
- 小知右上角搜索入口暂只在实现完整可用的历史搜索后显示；不能放置无效按钮。

本 PR 不包含：首页重构、事件新模型、长期记忆 UI、教练提醒、后台每日复盘、统一四类搜索。它们在本底座验收后分 PR 接入。

## 多轮效果的明确标准

多轮效果不以“历史越多越好”为目标，而以以下五项为准：

1. **近距离指代正确**：最近 6 轮内的“它 / 那件事 / 上一个方案”能由原话还原。
2. **远距离主线可续**：超过窗口的同一主题通过段摘要或旧记录检索恢复，不需要携带完整历史。
3. **当前事实优先**：最近消息与旧摘要冲突时，系统提示模型以最近消息为准。
4. **无关内容不污染**：只因共享宽泛词汇而命中的旧内容不进入有限上下文。
5. **成本有硬上限**：无论历史增长多少，输入上下文都受配置预算约束。

## Task 1：建立消息与分段数据库底座

**Files:**

- Modify: `src/types.ts`
- Modify: `src/db.ts`
- Create: `src/assistant/types.ts`
- Create: `scripts/test-assistant-database.cjs`
- Modify: `package.json`

**Step 1: 写失败测试**

在内存 SQLite 适配器中验证：

- 初始化后存在 `assistant_messages`、`conversation_segments`、`assistant_requests`。
- 同一 `legacy_entry_id` 只能迁移一次。
- 同一 `request_id + role` 只能保存一条消息。
- 消息分页以 `(created_at, id)` 为稳定游标。
- 失败请求的用户消息仍存在，助手消息不存在。

**Step 2: 运行并确认失败**

Run: `npm run test:assistant-db`  
Expected: FAIL，提示表或仓储函数不存在。

**Step 3: 最小实现**

新增类型：

```ts
export type AssistantRole = 'user' | 'assistant';
export type AssistantMessageStatus = 'saved' | 'sending' | 'failed';

export interface AssistantMessage {
  id: string;
  requestId: string;
  role: AssistantRole;
  content: string;
  source: 'text' | 'voice' | 'legacy' | 'contextual';
  status: AssistantMessageStatus;
  segmentId: string;
  createdAt: number;
  legacyEntryId: string | null;
}
```

使用版本化、幂等建表；为 `created_at`、`segment_id`、`request_id` 建索引。公开最小仓储函数：保存用户消息、保存成功轮次、标记失败、分页读取、读取当前段、旧 entry 投影。

**Step 4: 运行测试**

Run: `npm run test:assistant-db`  
Expected: PASS。

**Step 5: 注册聚合测试并提交**

把 `test:assistant-db` 加入 `npm test`。  
Commit: `feat: add assistant conversation storage`

## Task 2：实现可度量的上下文选择器

**Files:**

- Create: `src/assistant/token-budget.ts`
- Create: `src/assistant/context.ts`
- Create: `scripts/test-assistant-context.ts`
- Modify: `package.json`

上下文选择器只依赖显式传入的数据，避免为了测试绑定数据库。

**Step 1: 写失败测试**

覆盖：

- 最近消息最多 12 条并保持角色顺序。
- 当前段摘要总是排在旧段摘要之前。
- 相关历史段最多 3 个，旧记录最多 5 条。
- 同一来源不重复进入上下文。
- 最近事实与旧摘要冲突时，输出明确的“最近内容优先”规则。
- 超过预算后先裁剪低相关旧记录，再裁剪旧段，最后才缩短最老的近期消息。
- 包含中英文混合文本时 Token 估算保持保守且确定。

**Step 2: 运行并确认失败**

Run: `npm run test:assistant-context`  
Expected: FAIL，模块不存在。

**Step 3: 最小实现**

实现纯函数：

```ts
buildAssistantContext({
  recentMessages,
  currentSegmentSummary,
  retrievedSegments,
  relevantEntries,
  launchContext,
  inputBudget: 6000,
})
```

返回模型消息数组和统计：估算 Token、各来源条数、被裁剪条数。统计可以写日志，但不得记录完整用户文本或 API Key。

**Step 4: 运行测试并提交**

Run: `npm run test:assistant-context`  
Expected: PASS。  
Commit: `feat: add bounded multi-turn context selection`

## Task 3：实现小知模型协议与解析校验

**Files:**

- Create: `src/assistant/prompt.ts`
- Create: `src/assistant/provider.ts`
- Create: `src/assistant/protocol.ts`
- Create: `scripts/test-assistant-protocol.ts`
- Modify: `package.json`

**Step 1: 写失败测试**

验证合法返回、代码块包裹 JSON、缺失 reply、超长摘要、非法 segment action、网络超时和调用方取消。

**Step 2: 运行并确认失败**

Run: `npm run test:assistant-protocol`  
Expected: FAIL。

**Step 3: 最小实现**

模型输出协议：

```ts
interface AssistantTurnOutput {
  reply: string;
  segment: {
    action: 'continue' | 'start_new';
    summary?: string;
  };
}
```

系统提示明确：

- 自然回复使用中文，不暴露内部分类或摘要。
- 仅在语义明显切换或当前段过长时 `start_new`。
- 摘要只保留事实、决定、未决问题与用户当前立场，最多 240 个中文字符。
- 不声称已经建立待办、事件或记忆；这些操作尚未接入。
- 最近原话与摘要冲突时采用最近原话。

**Step 4: 运行测试并提交**

Run: `npm run test:assistant-protocol`  
Expected: PASS。  
Commit: `feat: add structured assistant turn protocol`

## Task 4：实现单轮编排、幂等与恢复

**Files:**

- Create: `src/assistant/orchestrator.ts`
- Create: `scripts/test-assistant-turn.cjs`
- Modify: `src/db.ts`
- Modify: `package.json`

**Step 1: 写失败集成测试**

覆盖：

- 用户消息在模型调用前已经保存。
- 同一 request ID 并发发送只产生一次模型调用和一条助手回复。
- 模型失败后用户消息标记 `failed`，点击重试复用原 request ID 和原消息。
- 保存助手结果失败时事务回滚，不出现虚假回复。
- `start_new` 时旧段摘要更新，新回复进入新段。
- 页面卸载只取消 UI 等待，不删除已保存消息；重进可恢复失败状态。

**Step 2: 运行并确认失败**

Run: `npm run test:assistant-turn`  
Expected: FAIL。

**Step 3: 最小实现**

`sendAssistantTurn` 分为三个明确阶段：

1. 独占短事务保存用户消息与 request。
2. 事务外构造上下文并调用模型，避免长事务锁库。
3. 独占短事务校验 request 状态并保存助手消息、分段摘要和成功状态。

运行时使用单飞 Map 抑制同一 request 的并发调用；数据库唯一约束负责跨重启幂等。

**Step 4: 运行测试并提交**

Run: `npm run test:assistant-turn`  
Expected: PASS。  
Commit: `feat: orchestrate durable assistant turns`

## Task 5：实现“小知”页面

**Files:**

- Create: `app/(tabs)/assistant.tsx`
- Create: `src/components/AssistantComposer.tsx`
- Create: `src/components/AssistantMessageBubble.tsx`
- Create: `src/components/AssistantEmptyState.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `src/components/Composer.tsx`（仅在能安全复用语音逻辑时抽取；否则不改）

**Step 1: 写组件可测试逻辑**

将列表分页、发送状态合并、重试定位和普通进入行为提取为纯状态函数，并为以下状态写测试：空态、发送中、失败、重试成功、历史分页去重。

**Step 2: 实现页面**

- 使用普通顺序 `FlatList`，首次加载和发送成功后滚到底部；向上触发旧消息分页。
- `KeyboardAvoidingView` 仅包裹对话页；输入框多行、发送目标至少 44×44。
- 普通进入不写消息、不调用模型、不自动聚焦。
- 空态只显示静态示例，不进入消息历史。
- 失败消息保留原文并显示“重试”；离开重进后状态仍可见。
- Tab 使用已确认的“小知”标签和更清晰的机器人图标，选中 / 未选中状态不同。
- 搜索能力未完成前不显示右上角搜索按钮。

**Step 3: TypeScript 与状态测试**

Run: `npm run typecheck && npm run test:assistant-ui`  
Expected: PASS。

**Step 4: 提交**

Commit: `feat: add Xiaozhi continuous conversation tab`

## Task 6：旧原声迁移与相关历史检索

**Files:**

- Create: `src/assistant/migration.ts`
- Create: `src/assistant/retrieval.ts`
- Create: `scripts/test-assistant-migration.cjs`
- Modify: `src/db.ts`
- Modify: `app/_layout.tsx`
- Modify: `package.json`

**Step 1: 写失败测试**

验证：旧 entry 按原创建时间投影为用户消息；重复启动不重复；迁移中断可续；FTS 命中按相关性与新鲜度排序；宽泛单字查询不把无关历史塞进上下文。

**Step 2: 实现**

启动数据库成功后执行小批量幂等迁移。上下文检索优先当前分段和显式启动上下文，再检索历史段与旧 entry；检索失败降级为最近 6 轮，不阻塞发送。

**Step 3: 测试并提交**

Run: `npm run test:assistant-migration`  
Expected: PASS。  
Commit: `feat: migrate legacy entries into assistant history`

## Task 7：效果评估与观测

**Files:**

- Create: `scripts/test-assistant-conversation-quality.ts`
- Create: `docs/quality/xiaozhi-multiturn-fixtures.md`
- Modify: `package.json`

**Step 1: 建立固定测试集**

至少包含：

1. 最近两轮指代。
2. 话题切换后再返回旧话题。
3. 时间变化导致旧摘要过期。
4. 两个相似但不同项目不能误合并。
5. 用户明确纠正旧理解。
6. 600 条历史消息下输入预算仍不增长。

纯函数测试验证上下文选择；模型效果测试使用固定 mock 响应，不把联网模型结果作为 CI 成败条件。真机验收时使用同一组话术做人工效果记录。

**Step 2: 注册并运行聚合测试**

Run: `npm test`  
Expected: 所有旧测试与新增测试 PASS。

**Step 3: 提交**

Commit: `test: add Xiaozhi multi-turn quality fixtures`

## Task 8：完整验证与 PR

**Files:**

- Modify: `docs/plans/2026-09-13-secretary-mentor-v03-design.md`（仅记录实现偏差或确认后的调整）

**Step 1: 自动检查**

Run: `npm run ci`  
Expected: typecheck 和完整 `npm test` 均通过。

**Step 2: 真机检查**

由于本 PR 不新增原生依赖，可先使用 Metro Reload 验证 JavaScript / UI；若语音依赖或本机构建状态异常，再重装现有开发构建。手工验证：

- 普通进入小知保持安静。
- 发送后原话立即出现，回复成功后持久保存。
- 断网失败、重启 App、恢复网络后重试。
- 连续追问、切换话题、返回旧话题。
- 语音转写、键盘遮挡、长消息、快速重复点击发送。
- 旧原声只迁移一次，滚动到历史时顺序正确。

**Step 3: 代码审查与 PR**

检查分支差异，确认没有内部预览、调试路由、测试文案或 API Key 进入用户界面。推送分支并创建 PR；等待 GitHub `CI / validate` 通过，不绕过 required check。

**Step 4: 交付信息**

报告需求范围、PR 与 commit、自动检查、设备 / OS / 构建类型、人工用例、原生与数据迁移影响、未解决风险、知识文档与回滚点。PR 合并和设备版本更新按仓库发布流程分别记录。

## 后续 PR 顺序

1. 结构化对象与合并回执：待办、事件、长期记忆及关系。
2. 首页重构与事件详情：本周、提醒、事件。
3. 统一四类搜索与关系归组。
4. 每日复盘与后台尽力执行。
5. 完整旧画像迁移、备份格式升级和知识沉淀。
