# Agent 上下文路由与 Skill 自维护

状态：2026-09-22 用户确认验收，随 PR #28 发布；GitHub `CI / validate` 已通过。

## 背景与结论

项目开发资料分成三层：`AGENTS.md` 只保留每轮必须知道的硬门禁，`docs/CURRENT.md` 提供稳定短入口，`assistant-app-work` Skill 按新需求、继续 PR、真机验收和发布收口加载阶段资料。Git 与 GitHub 的活跃状态由只读快照动态读取，不写死在文档中。

成功 CI 由 `npm run ci:agent` 折叠为短摘要并保留完整临时日志；GitHub 和正式交付仍直接以 `npm run ci` 为权威门禁。安静输出不能改变测试集合、退出码或失败诊断。

## Skill 自维护决策

Skill 不在运行时自动改写自己。任何 PR 如果改变了 Skill 路由的路径、命令、权威来源或交付门禁，必须在同一 PR 中更新 Skill，或明确验证现有路由仍正确。易变化的操作细节继续留在权威文档中，Skill 只维护入口、阶段选择和上下文边界。

自动化验证仓库内链接仍可解析、入口体积保持有界；发现或路由行为变化还必须用全新 Codex 会话验证。这样 Skill 能随项目演进，又继续受 Git、PR、CI 和用户验收约束。

## 可复用经验

- 当前分支、PR、检查状态属于动态事实，不适合进入长期文档。
- 归档和历史方案默认不进入上下文；只有追溯决策时定向读取。
- 成功日志应摘要化，失败日志必须保留原始退出码、诊断尾部和完整日志位置。
- 上下文工具必须只读；脏工作区只能报告，不能清理或覆盖。
- 路由 Skill 应保持短小。发现新场景时先链接已有权威资料，不复制同义规则。

## 验证与发布信息

- Skill `quick_validate.py`：通过。
- `npm run test:agent-tooling`：通过，覆盖只读快照、归档排除、输出上限、CI 退出码、Skill 链接和体积约束。
- `npm run ci:agent`：通过，完整执行 TypeScript 与 34 个测试组。
- GitHub `CI / validate`：通过。
- 用户验收：2026-09-22 已确认 PR #28。
- App 运行时、SQLite、原生依赖、权限和 Bundle ID 均无变化；不需要 Reload、重装或设备发布。

## 关联与回滚

- PR：#28 `codex/context-slimming`
- 验收提交：`8f8118b`
- 设计：`docs/plans/2026-09-22-agent-context-slimming-design.md`
- 回滚整个 PR 即可；GitHub 仍直接运行原始 `npm run ci`，不会削弱主线门禁。
