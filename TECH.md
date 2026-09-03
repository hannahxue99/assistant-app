# 个人助手 App — 技术方案 v1.0

> 依据：`PRD.md` v1.1（2026-08-31 对齐版）、`DESIGN.md` v1.0（含 corner cases）
> 平台：Expo SDK 57 / React Native 0.86 / expo-router 57 / expo-sqlite / iPhone 优先

## 一、需求清单（PRD V1.0 功能点）

| # | 需求 | 验收要点 |
|---|---|---|
| F1 | 快速记录 | 打开即输入；文字 + 按住说话转文字；空输入拦截；`#标签` 手动补充 |
| F2 | 理解+归档 | 原文立即落库；异步理解意图/时间/标签/主题；失败标 pending 联网补理解 |
| F3 | 待办 | 勾选完成（当天划线、次日消失）；理解出的时间自动挂本地提醒；逾期沉入今天警示置顶 |
| F4 | 首页·本周待办 | 今日起 7 天窗；行 = 勾选框 + 日期+星期+时间 + 概要；空日期不展示；全空出虚线空态 |
| F5 | 首页·长期待办 | 7 天之后的未完成待办升序；描边卡；无则整模块隐藏；入窗自动升入本周 |
| F6 | 主人的备忘录·聚合 | 主题卡（主题/条数/最新概要/最新时间）+ 无主题时间流卡混排；顶部全文搜索（FTS trigram） |
| F7 | 主人的备忘录·用户原声 | 纯流水：`MM-DD HH:mm:ss` 等宽时间戳 + rawText 原文；倒序；无控件 |
| F8 | 用户原声详情页 | 时间戳 + 标题 + 正文 + 手动编辑 + 删除（二次确认）；标题=正文时只显示一次；无语音入口 |
| F9 | 主题详情页 | #主题+条数；最新状态卡；历史轨迹倒序；单条主题无轨迹区 |
| F10 | 原地编辑 | 手动/AI 两模式；AI 快捷指令 chips（更简洁/更正式/突出里程碑）；保存覆盖写回 summary；快照入 correctedFrom；AI 无 Key 置灰；禁存空；退出丢弃确认 |
| F11 | 通知 | 早 8:00：今天→7 天窗→最近 5 条；晚 21:00：明日起 7 天窗→最近 5 条；独立开关（行内）；待办到点提醒默认开启 |
| F12 | 我的页 | 主人页头+陪伴数据；画像卡编辑/保存/丢弃；导出 Markdown 直调分享面板；统计纯展示 |
| F13 | 理解引擎子页 | LLM 开关 + baseUrl/model/key + 保存；Key 空显示「未配置」；关闭即纯规则模式 |

## 二、架构与模块划分

```
app/                          # 路由层（expo-router，只负责组装与导航）
├─ _layout.tsx                # 根 Stack：初始化 DB/通知 → (tabs) + stack 页
├─ (tabs)/_layout.tsx         # 2 个底 Tab：首页 / 我的
├─ (tabs)/index.tsx           # 首页（待办 + 备忘录 + 沉底 Composer）
├─ (tabs)/profile.tsx         # 我的页
├─ entry/[id].tsx             # 用户原声详情页（stack）
├─ topic/[name].tsx           # 主题详情页 + 原地编辑（stack）
└─ settings/llm.tsx           # 理解引擎子页（唯一 stack 设置页）

src/
├─ db.ts                      # 数据层：SQLite + FTS5 trigram；全部读写经此
├─ types.ts                   # Entry / Profile / Settings / TopicGroup
├─ theme.ts                   # 色板 / 字号 / 圆角（设计还原唯一来源）
├─ engine/
│  ├─ understand.ts           # 编排：规则先行 → LLM 精解 → 降级链
│  ├─ time.ts                 # 中文口语时间归一化（纯规则，离线）
│  ├─ llm.ts                  # OpenAI 兼容 Provider：理解 + 文案改写
│  ├─ schedule.ts             # 纯函数：待办分窗（本周/长期/逾期/完成态）
│  ├─ topic-order.ts          # 聚合主题的置顶/更新时间排序
│  ├─ notification-copy.ts    # 晨晚待办筛选 + 通知文案（纯函数）
│  └─ notifications.ts        # 未来 14 天晨晚通知排程 + 待办到点提醒
└─ components/
   ├─ Composer.tsx            # 沉底输入：描边输入框 + 麦克风图标 + 语音转写
   ├─ EditAction.tsx          # 统一编辑入口：铅笔进入 / 完成退出，支持页面与模块字号
   └─ EntryCard.tsx           # 通用条目卡（详情入口）
```

**交互关系**：页面 → engine（ingest/rewrite）→ db（落库/回填）→ 页面 useFocusEffect 重载。LLM 调用全部 fire-and-forget，永不阻塞记录。

## 三、数据结构与接口

### 数据模型（SQLite，与 PRD 对齐）

`entries(id, raw_text, kind, summary, due_at, remind_at, topic, tags, persons, parse_status, parse_source, corrected_from, created_at, done, done_at, source)` + `entries_fts(trigram)` + `profile` + `settings`

`topic_preferences(topic, pinned_at)` 保存主题级置顶状态；主题改名/合并时与 entries.topic 在同一独占事务中迁移。

- `raw_text` 永不改动（用户原声展示）；`summary` 可被编辑覆盖
- `corrected_from`：编辑前后快照 JSON，只存档不展示（P2 画像用）
- 时间存 UTC ms，渲染按设备时区

### 数据层接口（src/db.ts）

```ts
// 已有：insertEntry / updateParsedResult / applyCorrection(带快照) / setDone
//      deleteEntry / listEntries(FTS) / listByKeyword / listTopicGroups / listByTopic
//      getProfile / saveProfile / getSettings / saveSettings / exportMarkdown
// 新增：
listWeekTasks(): Promise<Entry[]>        // 逾期未完成 + 7 天窗口内未完成 + 今天已完成
listLongTermTasks(): Promise<Entry[]>    // due_at ≥ today+7d，done=0，升序
countEntries(): Promise<number>          // 统计行：总条数
firstEntryAt(): Promise<number | null>   // 统计行：陪伴天数起算点
```

### 引擎接口

```ts
ingest(input, settings): Promise<Entry>            // 已有：先落库后异步精解
rewriteWithLlm(text, instruction, cfg): Promise<string>  // 新增：AI 编辑改写
groupWeekTasks(entries, now): WeekGroup[]          // 新增纯函数：按日分窗（可单测）
```

### 关键流程

**记录**：Composer 提交 → `ingest` → 规则同步回填（首帧即正确）→ LLM 异步精解 → `useFocusEffect` 重载
**编辑**：主题详情页点编辑 → 卡片变 TextInput →（AI 模式）chips 调 `rewriteWithLlm` 回填 → 保存 → `applyCorrection({summary})`（自动存 correctedFrom 快照）
**导出**：`exportMarkdown` → `Share.share` 系统面板
**通知**：开关变化 / App 启动 / 待办新增、编辑、完成、删除 → `scheduleDailyNotifications` 重挂未来 14 天的逐日通知。晨问从触发日当天开始按“当天→7 天窗→最近 5 条”筛选；夜间从次日开始按“7 天窗→最近 5 条”筛选；只取未完成且未逾期、有时间的待办，无结果则当天不排通知。逐日 DATE 触发是因为本地通知正文会在排程时固定。

## 四、设计还原要点（对照 DESIGN.md）

### 首页（index.tsx）
- 顶部小字 `M月D日 星期X · 今天`（11px dim）；无页面大标题
- 本周待办：18px/500 标题；行 = 圆形勾选框 + `M/D 周X HH:mm`（无时刻显「全天」）+ 概要；今天行警示底色；逾期带「已逾期」标且排最前；完成行灰色划线仅当天
- 全空空态：虚线框 + 日历图标 + 「这周没有安排，记点什么？」+ 副文案口语示例
- 长期待办：14px dim 标题；描边卡无底色；`M/D 周X HH:mm`；无则隐藏
- 主人的备忘录：18px/500 标题（与本周待办同级）；胶囊分段控件「聚合｜用户原声」
- 聚合：顶部搜索框；主题卡（#主题 琥珀色 + 条数 + 最新概要 + `最新 MM-DD HH:mm`）；时间流卡（时间戳 + 概要）
- 用户原声：等宽 11px 时间戳 + 13px 原文；0.5px 细线分隔；无卡片无底色
- Composer 沉底固定（KeyboardAvoidingView）：描边输入框、占位「记点/改点什么…」、右侧麦克风图标（Ionicons，非文字）

### 详情页
- 用户原声：返回 + 等宽完整时间戳 + 16px 标题 + 13px 正文（标题=正文只显示一次）+ 底部删除（Alert 二次确认）
- 主题：#主题+条数页头；最新状态卡（info 底色，编辑态换 accent 边框 + TextInput）；历史轨迹同用户原声样式；底部三按钮 手动编辑✏️ / AI 编辑✨ / 保存（置灰→点亮）；AI 模式浮出 chips；AI 不可用置灰并提示

### 我的页
- `主人` 18px + 「已陪伴 N 天 · 共 M 条记录」
- 画像卡（灰底）：目标/雷区展示 → 铅笔进编辑态（边框高亮 + 保存画像；未保存离开即丢弃）
- 提醒卡：两行内联开关（早 8:00 晨间待办 / 晚 21:00 夜间待办）
- 导出数据行（Markdown ⤴）→ 直接 `Share.share`；统计行灰底不可点
- 理解引擎行 → `/settings/llm`（状态：已开启 / 未配置警示 / 已关闭）

## 五、测试策略

- 纯逻辑单测：`engine/time.ts`（已有 test-time.ts）、新增 `engine/schedule.ts` 分窗测试（tsx 直跑）
- 静态检查：`tsc --noEmit`
- 手工用例库：`TESTCASES.md`（功能/边界/异常/界面还原四类），真机逐项核验
