# 可导入 Markdown 备份

> 最近更新：2026-09-22，PR #27 增加完整备份 V3。

## 产品决策

- 导出文件继续保持人类可读，同时在末尾追加 `assistant-app-export-v2` 机器数据胶囊。
- 只支持导入本 App 新版导出的 Markdown，不猜测解析旧版或任意手写 Markdown。
- 导入前展示新增、更新、忽略和冲突数量；用户确认后才写入数据库。
- 导入是合并恢复，不是同步：备份中缺失的本地记录不会被删除。
- 不导出 LLM API Key、接口地址和模型配置。

## 完整备份 V3

- 默认只生成一种 `assistant-app-export-v3` Markdown；可读摘要和机器数据胶囊在同一文件中，不重复保存对话正文。
- V3 全量覆盖记录与待办、画像、主题偏好、连续对话、事件与进展、对象关系、操作回执、长期记忆及来源。
- `entries` 是旧记录的权威表达。为新版历史列表生成的 `legacy-*` 消息只是投影，不作为第二份对话重复导出；不为它们伪造 request。
- 真实事件、关系和记忆继续保留；若来源消息只是被排除的 legacy 投影，导出快照仅把 `sourceMessageId` 归一化为 `null`，不改写手机数据库。
- 历史 operation 可以指向后来已删除、撤销或修改的对象。它仍进入备份作为历史回执，但导入时只有目标仍与 `afterSnapshot` 一致才恢复撤销能力。
- V2 与旧日志的现有导入入口继续可用，但不会扩大为第二种 V3 导出样式。

## 冲突与事务

- 条目以稳定 ID 匹配，使用内部 `revisionAt` 判断版本新旧；界面展示的 `updatedAt` 仍只表示用户编辑时间。
- 导入版本较新时覆盖本地，反之保留本地；版本时间相同但内容不同时也保留本地。
- 冲突两侧完整快照写入 `import_conflicts`，避免静默丢失。
- 主数据、画像、主题置顶和全文索引在 SQLite 独占事务内处理；校验或事务失败时不污染现有数据。
- 同一文件重复导入时内容全部忽略，保证幂等。
- V3 在接触 SQLite 前完整验证 ID、请求/消息、事件、关系、记忆和计数；确认导入后在单个独占事务中重新计算合并决策。
- V3 使用 `assistant_import_conflicts` 保存通用对象冲突；搜索、通知和日历是提交后可重试投影，失败不回滚已经恢复的事实。

## 提醒补偿

导入记录写入后，将受影响 ID 放入 `notification_sync_queue`。提醒同步成功后清除；失败则保留队列，并在下次 App 启动时补建。这样提醒系统失败不会回滚已成功恢复的用户数据。

## 踩坑

- `expo-document-picker` 是原生模块：首次加入后仅 Reload 不够，必须重新编译并覆盖安装 Dev Client；保持 Bundle ID 不变可保留本地 SQLite 数据。
- 测试 App 使用 Debug 构建时 `__DEV__` 为真。开发工具即使受 `__DEV__` 保护，也会出现在用户真机测试页面；本项目决定从“我的”页面彻底移除组件预览入口，仅保留内部路由。
- Markdown HTML 注释中不能出现连续连字符，序列化胶囊需要安全转义，解析后再还原为原始文本。
- 不能假设 `assistant_messages.request_id` 一定对应真实 request：旧 `entries` 投影只写消息。V3 快照必须去重这些投影，同时保留原始 entry。
- 不能要求历史 operation 的目标对象当前仍存在；目标可能被后续操作删除。格式层保留历史，合并规划层负责判断撤销能力是否仍有效。
- “Metro 已启动”不等于手机已加载。Tunnel 重启会更换 `exp.direct` 地址；必须读取实际 ngrok URL、通过 USB 传给手机，并看到手机请求后的完整 iOS Bundle。

## 验证方式

1. 导出 Markdown，确认可读内容存在且文件中不含 LLM Key。
2. 立即导入同一文件，预览应全部为忽略；重复导入不产生重复数据。
3. 导入无效、旧版、损坏或超限文件，确认数据库不变。
4. 检查画像、主题置顶、完成状态和提醒时间恢复正确。
5. 检查“我的”页面在 Debug 与 Release 中均无组件预览入口。
6. 构造只有 legacy 投影、没有对应 request 的旧数据，确认 V3 仍成功导出且不产生重复消息。
7. 构造 operation 指向已删除待办的历史，确认导出成功、回执保留、无效撤销能力在导入预览中计为跳过。

## PR #27 验收与发布记录

- 用户于 2026-09-22 确认 Dev 真机导出成功，并授权与 PR #25、#26 一起合并、发布 Release。
- 自动验证：本地 `npm run ci` 与 GitHub `CI / validate` 通过；V3 格式、合并规划、事务数据库、界面状态、V2 和旧日志回归均在聚合 `npm test` 中。
- 真机验收：iPhone 17 / iOS 26.6.2，`com.huanxue.assistantapp.dev`，PR #25 + #27 联合工作区通过 Expo Tunnel 完整加载；真实数据暴露的 legacy 投影和过期 operation 两类问题均补回归后通过。
- 发布影响：新增向后兼容 SQLite 表，不新增原生依赖、权限或 Bundle ID；Release 覆盖安装保留生产容器，回滚代码时保留新增表和已恢复事实。
- PR：[#27](https://github.com/hannahxue99/assistant-app/pull/27)，发布前功能头提交 `e7c6905`；合并前稳定基线 `07c1c3c`。

## 回滚点

回滚 PR #7 可移除早期导入入口。V3 应优先 revert PR #27 的 GitHub 合并提交；新增的 `revision_at`、`import_conflicts`、`notification_sync_queue`、`assistant_import_conflicts` 和 `assistant_projection_jobs` 均为向后兼容字段/表，旧代码不会读取，无需破坏性降级，也不要删除用户已经恢复的事实。
