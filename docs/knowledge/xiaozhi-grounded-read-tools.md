# 小知按需读取与真实回执闭环（PR #22）

发布日期：2026-09-21。分支 `codex/xiaozhi-grounded-tools`，20 个提交（含一次方案回滚）。

## 产品决策

小知回答或更新事件/待办/记忆前必须读到数据库真实状态：九个只读工具（搜索/读取/列表）是模型获得现有对象的唯一入口；写入只允许发生在"本轮精确读取过 + revision 未过期"的对象上。最终回复只能基于真实执行回执生成，规划阶段的草稿回复永不展示。运行状态逐行累加（读取/思考/更新），落定收成单行过程摘要并持久化。

## 根因与关键坑

### 1. DeepSeek 官方文档与实际 API 行为相反（踩了两轮）

- 文档说"不要把 `reasoning_content` 回传后续请求"。实测（deepseek-flash + thinking）：**携带 `tools` 的续轮必须回传，缺失直接 400**（"The reasoning_content in the thinking mode must be passed back to the API"）；不带 tools 的请求该字段被忽略不报错。
- 教训：**文档不可作为唯一依据，真实 API 对照实验才是**。第一次按文档删回传（d0446e3），用户实测"十一出行"全部失败后用 30+ 次对照实验复现并恢复（5bada0a）。

### 2. 内容风控："敏感词 + 数字串"组合触发（隐蔽性极高）

- 现象：搜索含"北京"的事件后续轮 400 `Content Exists Risk`，但单独发"北京"通过；时挂时过无法归因。
- 定位方法：从失败样本做贪心收缩得最小失败集，再逐字段二分——最终发现触发条件是 **currentState 含"北京" 且事件 `updatedAt=1789640590929`（数字串含"8964"）同时出现**在 tool 消息里。换"南京"或换时间戳均可通过（各 6/6）。
- 根因：**原始毫秒时间戳是 13 位任意数字串，与敏感词组合触发风控**。任意时间戳有不可忽视的概率含敏感数字组合，用户库越大踩中越多。
- 系统性修复（c2da75d）：**工具结果时间字段统一 ISO 字符串**——机器表示不该给模型看，ISO 语义无损且从表示层消除整类巧合。曾试过"敏感词中点化重试"方案（71502d4），因建立在错误的单关键词理论上且污染数据语义，已回滚（0aa735c）。
- 教训：**风控触发条件可能极反直觉（词+数字组合），静态小样本测试会骗人；二分收缩到最小失败集是可靠路径**。

### 3. 模型输出瑕疵的三层容错原则（本 PR 三次应用后收敛）

| 层级 | 处理 | 例子 |
|---|---|---|
| 瑕疵降级 | 修正/截断后继续 | 数量超限截断（operations 10 / deltas 4 / todos、progress 10）、segment.action 非法默认 continue、forget 缺 evidence 单项拒绝、工具参数错回传自纠、空 content 重试一次 |
| 结构拒绝 | 整轮失败 | reply 缺失、非 JSON、缺必填字段、非法枚举/日期、重复键 |
| 安全否决 | 逐项一票否决 | ID 不在可读集合、revision 过期、evidence 不逐字、幂等冲突、级联删除无决策 |

原则一句话：**模型"多给的"收下够用部分，"给错了"才拒绝；回执如实反映处理了几条，不虚报不隐瞒**。

### 4. 决策日志是排障闭环的关键

日志字段（tool_calls_json / execution_rejected_json / narration_json / stage_durations_json）让"用户一句反馈 → 拉设备 DB → 一条日志定位根因"成为常态（本 PR 至少 5 次根因定位走了这条路）。配套 `__DEV__` 调试路由 `/debug/decisions` 在设备端直接查看。拉设备 DB：`xcrun devicectl device copy from … Documents/SQLite/assistant.db`。

## 关键权衡

- **读取额度 6 轮/12 次 + 收敛轮**：超限不判失败，进入无工具收敛轮声明未核实部分。搜索召回差会放大额度消耗（FTS 优化是已记录的跟进项）。
- **搜索 8 条截断 vs 列表全量**：list_* 工具（ID+标题、无正文、不授权写入）服务总览需求，规避截断盲区。
- **快照跨轮复用**：同分段内 revision 未变的精确读取免工具续用；写入仍要过 revision 校验。

## 可复用模式

- 工具循环的容错骨架：参数错误→回传自纠；额度用尽→收敛轮；空 content→指示重试；全程协议警告进日志。
- 时间戳给模型一律 ISO；revision 保持数字（本地校验必需的小整数）。
- 上下文注入最小化：launchContext 只给 ID 指针，事件正文只能经工具读取进入上下文。

### 5. 操作扩展模式（PR #23）

删除进展（delete_event_update）与解除关联（unlink_todo_event）沿用既有模式快速落地：协议解析 → 可读集合校验（目标必须本轮 get 过）→ 软删执行（undone_at）→ 撤销恢复。新增操作需同步四处：action-types、protocol、validator、action-store（+ action-schema 的 CHECK 约束走事务化重建迁移）。VM 测试的 provider stub 输出必须用 camelCase（orchestrator 消费的是解析后对象，不再走 snake_case 协议层）。

### 6. 已知不修：阶段耗时展示口径

落定摘要"读取 X 秒"几乎不会出现——本地 SQLite 查询毫秒级（<1s 被展示过滤），模型往返时间记入 thinking。用户感知的"读取"实为模型决策。用户已确认不修，保留现状。

## 验证与回滚

- 验证：`npm run ci`（22 套件）+ 真实 API 端到端（三轮工具循环、风控组合、降级路径）+ Dev 真机（合并、全库总览、连续分页读取、断网兜底）。
- 回滚点：PR #22 整体 revert 即回到 `codex/xiaozhi-conversation-v03` 之前的行为；单项回滚见提交链（71502d4→0aa735c 已示范）。
- 迁移：加列式（tool_read_*、execution_*、narration_json、stage_durations_json），老库自动兼容，无数据迁移风险。
