# 项目知识库索引

这里保存已经验证过、可复用的产品决策和工程经验。每次需求验收后更新。

| 专题 | 内容 | 最近更新 |
|---|---|---|
| [V1 产品口径：完整愿景与实现进度分离](v1-product-baseline.md) | V1版本定义、目标/实现/发布三层状态、维护模式、验证与回滚 | 2026-09-17 |
| [V1 当前实现基线](secretary-mentor-v03-release.md) | 三入口、数据边界、事件多行状态、模型/代码职责、Release真机记录与回滚 | 2026-09-22 |
| [小知按需读取与真实回执闭环](xiaozhi-grounded-read-tools.md) | 九只读工具、真实回执、DeepSeek文档相反行为、风控词+数字串组合、三层容错原则、决策日志排障闭环 | 2026-09-21 |
| [小知 DeepSeek 原生联网搜索与 Agent 对话层级](xiaozhi-deepseek-web-search.md) | 服务端搜索规划、联网轮只读、来源持久化与备份、来源/思考/回复/回执层级、悬浮输入区渐隐 | 2026-09-23 |
| [小知移动端输入区、滚动状态与 Markdown 回复](xiaozhi-mobile-composer-and-markdown.md) | following/history 状态机、UI 线程键盘同帧、置底按钮、动态渐隐、安全 Markdown、16px 对话正文、PR #31/#32 验收与回滚 | 2026-09-24 |
| [三主页面视觉系统与小知品牌形象](generated-three-screen-visual-system.md) | 纯白三页、首页信息层级、统一回复/回执、设置卡、中间小知 Tab、防闪烁与 PR #34 验收 | 2026-09-25 |
| [小知推理运行状态与可查看思考](xiaozhi-runtime-reasoning.md) | 分层超时、可折叠思考、按需落库、历史时间、复制与单层输入区 | 2026-09-17 |
| [小知流式回复、模型日期与决策审计](xiaozhi-streaming-date-audit.md) | SSE流式预览、模型解析日期、候选/拒绝/提交日志、紧凑回执与PR #19回滚 | 2026-09-15 |
| [小知发送状态：可中止运行与草稿安全](xiaozhi-sending-state.md) | 用户消息立即入列、运行中继续输入、停止按钮、落库边界与PR #19回滚 | 2026-09-16 |
| [Agent 开发实战手册](agent-dev-playbook.md) | 环境铁律、Tunnel/USB/Metro Reload 端点契约、Release 固定 CMake 预检、真机验收方法论与流程纪律 | 2026-09-24 |
| [Agent 上下文路由与 Skill 自维护](agent-context-routing.md) | 稳定入口、动态快照、阶段加载、安静 CI、Skill 同 PR 自维护与回滚 | 2026-09-22 |
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
| [可导入 Markdown 备份](importable-markdown-backups.md) | V2/V3 数据胶囊、全量语义图、legacy 投影去重、事务合并、冲突与投影补偿 | 2026-09-22 |

## 新专题模板

新建文档时建议包含：背景与结论、方案取舍、根因与踩坑、可复用知识、验证方式、关联 PR/提交、回滚方式。
