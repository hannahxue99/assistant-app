# 项目知识库索引

这里保存已经验证过、可复用的产品决策和工程经验。每次需求验收后更新。

| 专题 | 内容 | 最近更新 |
|---|---|---|
| [“秘书 + 导师”V0.3 发布基线](secretary-mentor-v03-release.md) | 三入口产品结构、数据边界、模型/代码职责、删除语义、验证与PR #17/#18/#19回滚 | 2026-09-16 |
| [小知流式回复、模型日期与决策审计](xiaozhi-streaming-date-audit.md) | SSE流式预览、模型解析日期、候选/拒绝/提交日志、紧凑回执与PR #19回滚 | 2026-09-15 |
| [小知发送状态：可中止运行与草稿安全](xiaozhi-sending-state.md) | 用户消息立即入列、运行中继续输入、停止按钮、落库边界与PR #19回滚 | 2026-09-16 |
| [Agent 开发实战手册](agent-dev-playbook.md) | 环境铁律、Tunnel/USB/Metro Reload 端点契约、真机验收方法论与流程纪律 | 2026-09-15 |
| [App 图标重设计](app-icon-redesign.md) | 一勾即安定稿、60px对比度诊断、iOS 26单尺寸限制与prebuild连环坑 | 2026-09-09 |
| [苹果日历同步](calendar-sync.md) | 全天/定时、设备映射、删除墓碑、重试、跨日坑与PR #14发布 | 2026-09-08 |
| [GitHub CI 与 Git 工具链](github-ci-and-git-toolchain.md) | PR自动门禁、Git版本抢占、workflow scope与凭据helper优先级 | 2026-09-08 |
| [原声编辑与待办日期强一致性](entry-date-edit-consistency.md) | 单次确认、标题/正文/dueAt同步、M.D解析、PR #13发布与回滚 | 2026-09-08 |
| [SQLite FTS5 原生闪退](sqlite-fts-native-crash.md) | 连接关闭与内部语句清理、原生测试盲区、完整Reload及PR #12发布 | 2026-09-07 |
| [原声一致性与主题规模](entry-consistency-and-topic-scale.md) | 日期基准、条件回填、编辑事务、完整计数与空白安装；PR #10/#11发布记录 | 2026-09-06 |
| [数据库启动与通知异常隔离](database-startup-recovery.md) | 初始化等待、Fast Refresh、通知副作用隔离、补偿及发布记录 | 2026-09-05 |
| [真机开发与连接](../../README.md#真机调试踩坑存档) | Dev Client、Tunnel、HTTPS、端口和原生模块排障 | 2026-09-03 |
| [开发与 PR 流程](../DEVELOPMENT_WORKFLOW.md) | 设计先行、图示确认、分支开发、验收与沉淀 | 2026-09-03 |
| [聚合主题操作与编辑一致性](topic-actions.md) | 置顶排序、主题合并事务、共享编辑入口 | 2026-09-03 |
| [理解状态反馈](understanding-status.md) | 处理中、失败重试、批量异常升级与纯规则静默 | 2026-09-03 |
| [创建时间与内容更新时间](entry-time.md) | 更新时间触发边界、列表排序、旧库迁移与验证 | 2026-09-03 |
| [详情页点击内容编辑](tap-to-edit-details.md) | 连续点击区、标题正文解耦、自动保存防重复与导航竞态 | 2026-09-03 |
| [可导入 Markdown 备份](importable-markdown-backups.md) | V2 数据胶囊、事务合并、冲突历史、提醒补偿与原生模块验收 | 2026-09-04 |

## 新专题模板

新建文档时建议包含：背景与结论、方案取舍、根因与踩坑、可复用知识、验证方式、关联 PR/提交、回滚方式。
