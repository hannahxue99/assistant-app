# 事件当前状态多行文本设计

> 状态：已确认（2026-09-22，采用方案 A）
>
> 范围：修复当前 `codex/event-multiline-state` 分支，使事件当前状态可以稳定保留分行格式，并恢复完整 CI。

## 1. 问题与目标

事件“当前状态”经常同时包含现状、约束和下一步。单行压缩会降低可读性；当前分支虽然开始保留换行，但多行标准化逻辑分别存在于协议层和存储层，新增测试还直接导入了依赖 Expo SQLite 的存储模块，导致 Node 测试环境无法运行。

本次目标：

1. `create_event.current_state`、`update_event.current_state` 和 `event_delta.state.value` 保留有意义的换行。
2. Windows、旧 Mac 和 Unix 换行统一为 `\n`。
3. 每行首尾空格删除，行内连续空白压缩为一个空格，连续空行最多保留一个空行。
4. 协议层继续拒绝超过 600 个 JavaScript 字符单元的模型结果；存储层继续对内部调用做 600 长度截断，保持现有安全边界。
5. 测试只依赖纯 TypeScript 模块，不加载 React Native、Expo SQLite 或数据库连接。

## 2. 方案比较

### 方案 A：抽取纯文本标准化模块（推荐）

新增 `src/assistant/text-normalization.ts`，只负责无副作用的多行文本标准化。协议层和存储层复用同一函数，各自保留“超长拒绝”和“超长截断”的边界策略。测试直接导入纯模块。

优点：依赖边界清楚，Node 测试稳定，标准化规则只有一份；改动小。缺点：会增加一个很小的源文件。

### 方案 B：保留在 `event-store.ts`

测试改为通过数据库测试间接覆盖。

优点：文件更少。缺点：纯文本规则被绑在原生存储模块中，测试成本高，协议层仍会复制逻辑。

### 方案 C：只在协议层处理

让模型输出经过协议层时保留换行，存储层继续单行或自行处理。

优点：改动最少。缺点：导入、迁移、撤销或内部写入可能产生不同结果，无法保证数据库不变量。

选择方案 A。

## 3. 数据流

```text
模型 JSON
  → 协议字段必填校验
  → normalizeMultilineText
  → 600 长度校验（超长则拒绝整份协议）
  → 本地操作校验与事务
  → event-store 再次 normalizeMultilineText
  → 600 长度截断（防御内部调用）
  → SQLite
  → 事件卡片与详情页按 React Native Text 默认方式显示换行
```

本次不改变数据库 schema、操作协议字段、事件 revision、撤销快照或 UI 布局。

## 4. 边界情况

- `\r\n` 与单独 `\r` 都转换为 `\n`。
- 行首、行尾与空行中的空格不保留。
- 三个及以上连续换行压缩为两个换行，即最多一个视觉空行。
- 空字符串：存储层创建事件时仍允许空当前状态；协议中的三个目标字段仍要求非空。
- 超过 600：模型协议拒绝，避免静默改写模型语义；内部存储调用截断，保持原有防御行为。
- 列表符号、中文标点、Emoji 和普通换行原样保留；本次不引入 Markdown 渲染。

## 5. 实现范围

- 新增：`src/assistant/text-normalization.ts`
- 修改：`src/assistant/protocol.ts`
- 修改：`src/assistant/event-store.ts`
- 修改：`scripts/test-assistant-protocol.ts`
- 更新本设计状态，并在功能验收后补充知识索引和回滚点。

不修改页面、导航、数据库 schema、原生依赖、权限或 Bundle ID；Metro Reload 足以做设备验证。

## 6. 验收标准

1. 多行列表和段落写入后换行保持稳定。
2. CRLF、CR、行内多空格、行首尾空格和多余空行均按上述规则归一化。
3. 协议的创建事件、更新事件和事件增量状态三条路径都有回归断言。
4. 测试脚本不再导入 `event-store.ts`，单独运行协议测试不加载 React Native。
5. 干净源码环境 `npm run typecheck` 通过。
6. `npm run test:assistant-protocol` 通过。
7. `npm run ci` 全部通过。
8. 分支同步最新 `origin/main`，通过独立 PR 交付。

## 7. 回滚与发布影响

代码回滚只需回退本 PR；没有 schema 迁移。已经保存的换行文本仍是普通 SQLite 字符串，旧代码读取不会丢数据，只可能在后续再次写入时压成单行。
