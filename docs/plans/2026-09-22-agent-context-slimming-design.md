# Agent 上下文瘦身设计

> 状态：待评审，仅设计，不修改 App、CI 行为或 Codex 配置
>
> 目标：减少开发本项目时重复加载规则、历史文档和成功测试日志产生的 Token，同时保留现有设计先行、PR、真机验收和知识沉淀约束。

## 1. 当前问题

当前有效信息分散在三层：

- `AGENTS.md`：每轮都会进入上下文，既包含不可违背的产品流程，也包含只在真机或发布阶段需要的细节。
- `docs/DEVELOPMENT_WORKFLOW.md` 与 `docs/knowledge/agent-dev-playbook.md`：再次描述分支、PR、Metro、设备和发布流程。
- `docs/plans/` 与 `docs/knowledge/`：历史方案很多，宽泛搜索容易把无关内容和归档一起载入。

测试侧的 `npm run ci` 串行运行 35 个测试组。成功日志对人和 Agent 的决策价值很低，但会完整进入工具输出。

这不是模型能力问题，而是信息没有按阶段路由：低频细节常驻，高频事实又需要每次重新搜索。

## 2. 方案比较

### 方案 A：只精简文档

缩短 `AGENTS.md`，增加 `docs/CURRENT.md`，不创建 Skill 或脚本。

优点是改动小。缺点是 Agent 仍需自行判断读取哪些文档，跨窗口继续 PR 和运行 CI 时仍会产生大量重复输出。

### 方案 B：一个项目 Skill + 动态快照 + 安静 CI（推荐）

使用一个短小的项目 Skill 识别任务阶段，按需读取现有权威文档；用确定性脚本生成有限的 Git/PR 快照和 CI 摘要。`AGENTS.md` 只保留不可下放的硬约束。

优点是常驻上下文最小、行为可测试、细节仍可追溯。缺点是需要维护两个小脚本，并在新的 Codex 会话中验证项目 Skill 可被发现。

### 方案 C：拆成多个 Skill 或插件

分别创建设计、开发、PR、真机、发布、知识沉淀 Skill。

路由更细，但每个 Skill 的名称与描述都会参与发现，重复边界也容易漂移。当前项目规模不需要插件、MCP 或多个 Skill。

选择方案 B。

## 3. 总体结构

```text
用户请求
  → assistant-app-work Skill 判断阶段
  → 读取 docs/CURRENT.md 与动态项目快照
  → 只加载当前阶段的一份详细资料
  → 修改与聚焦测试
  → npm run ci:agent 输出摘要并保留完整日志
  → PR / 真机 / 收口阶段再加载对应规则
```

计划新增或调整：

```text
AGENTS.md
docs/CURRENT.md
docs/DEVELOPMENT_WORKFLOW.md
.agents/skills/assistant-app-work/SKILL.md
scripts/agent-context.cjs
scripts/ci-summary.cjs
scripts/test-agent-tooling.cjs
package.json
.gitignore
```

项目 Skill 的跟踪源放在 `.agents/skills/assistant-app-work/`。实施后必须在全新 Codex 会话中验证它能被发现；如果当前客户端不支持仓库级发现，则停止交付，不静默复制一份到个人目录。个人级安装属于仓库之外的状态，需要另行明确授权。

## 4. `AGENTS.md` 边界

`AGENTS.md` 继续保留每轮都必须知道的内容：

1. 写代码前读取 Expo SDK 57 精确版本文档。
2. 产品变更先审计、先设计，用户确认后才能实现。
3. 独立分支和 PR，交付前运行 `npm run ci`，新增测试登记到聚合命令。
4. 未经用户真机验收不合并；代码发布与设备发布分开记录。
5. 验收后、合并前沉淀知识并更新索引。
6. 无可用 Git 仓库或远端时停止实现。

以下内容移出常驻层，由 Skill 在相关阶段路由：

- Metro 监听者、工作目录、端口和 tunnel 传输契约。
- CoreDevice、锁屏状态、安装与 bundle 请求证据。
- Git 二进制、GitHub workflow scope 和 credential helper 排障。
- 合并前需要收集的完整发布字段。
- Dev / Release 身份、安装和数据隔离细节。

移出不等于删除。详细规则继续以 `docs/DEVELOPMENT_WORKFLOW.md`、`docs/RELEASE_CHECKLIST.md` 和相应知识文档为权威来源。

## 5. `docs/CURRENT.md`

这是项目的短入口，而不是第二份 PRD。控制在约 100 行，只记录稳定、当前且高频的事实：

- 产品和实现的权威文档入口。
- 当前技术栈及关键目录地图。
- 数据事实、投影和设备副作用的边界。
- 常用聚焦测试与完整交付命令。
- 默认检索边界：不读取 `docs/archive/**`；历史 `docs/plans/**` 只在当前 PR 引用或追溯决策时读取。
- 当前 Git/PR 状态不写死在文档，由快照脚本动态生成。

这样避免活跃 PR、分支和检查结果过期后继续误导新会话。

## 6. `assistant-app-work` Skill

`SKILL.md` 保持短小，只负责模式选择和读取路由，不复制仓库文档内容。

### 新需求

读取 `docs/CURRENT.md`、相关实现和最多一份最近的相关设计；不得批量读取全部 `docs/plans/`。产品/UI 请求仍执行设计确认门禁。

### 继续 PR

先运行动态快照，读取 PR 描述、提交、评论、检查和 changed files；只读取 PR 明确引用的设计与实现文档。继续可用的原分支和 PR。

### 真机验收

再读取开发流程的设备章节和 `agent-dev-playbook.md` 中的 Reload 固定流程，核对 Dev/Release、transport、端口、工作目录、设备锁和真实 bundle 请求。

### 发布收口

再读取 `docs/RELEASE_CHECKLIST.md` 与知识索引，按“验收 → 知识 → 合并 → main 同步 → 设备发布”收口。

### 默认禁止的上下文扩张

- 不读取 `docs/archive/**`，除非用户要求追溯历史。
- 不用无关键词的仓库级文档全文搜索作为第一步。
- 不重复加载 Skill 已指向的同义规则。
- 不使用多 Agent，除非用户明确要求并行或委派。

## 7. 动态上下文快照

`node scripts/agent-context.cjs` 输出有上限的事实摘要：

- 当前分支、上游、工作区是否干净。
- 相对 `origin/main` 的提交数与 changed files。
- 关联 PR（如果 `gh` 可用且已认证）的标题、状态和检查摘要。
- 从 changed files 和用户关键词匹配出的少量候选知识/设计文档。

输出默认不包含 diff 正文、完整提交日志、完整 PR 评论或文件内容。每组最多展示固定数量，超出时报告剩余数量。

失败边界：

- `origin/main` 不存在时回退到本地 `main`，两者都不存在则只报告当前分支。
- `gh` 不存在、未认证或网络失败时保留本地快照，并明确“PR 状态不可用”。
- 工作区有改动时只报告，不修改、不清理。
- 关键词没有命中文档时不扩大到全量读取，由 Agent基于 changed files 决定下一次精确查询。

## 8. 安静版 CI

新增 `npm run ci:agent`，内部执行现有 `npm run ci`，不改变 GitHub workflow 和 `npm run ci` 的权威地位。

- 完整 stdout/stderr 写入系统临时目录中的独立日志。
- 成功时只输出：类型检查通过、测试组通过数、耗时和日志路径。
- 失败时返回原始非零退出码，输出失败命令、最后一段相关日志和完整日志路径。
- 信号中断应尽可能转发给子进程并返回非零状态。
- 日志不进入仓库，不改变测试环境变量，不吞掉失败。

开发中可用聚焦测试；交付前仍必须执行完整 CI。PR 和 GitHub `CI / validate` 继续运行未经包装的 `npm run ci`。

## 9. 测试与验收

自动化测试新增到聚合 `npm test`，至少验证：

1. 快照在干净和脏工作区都只读，不修改文件。
2. 输出有固定上限，默认不出现 `docs/archive/`。
3. `gh` 不可用时仍能成功返回本地摘要。
4. 安静 CI 包装器完整保留子进程的成功/失败退出码。
5. 成功摘要保持短小，失败摘要包含诊断与完整日志路径。
6. Skill 通过 `quick_validate.py`，没有未完成占位符。
7. `npm run ci` 与 GitHub `CI / validate` 通过。

手工验收：

1. 新开一个 Codex 会话，在本仓库提出普通开发请求，确认项目 Skill 可被发现。
2. 普通需求只加载 `CURRENT.md` 和相关文件，不加载设备/发布资料。
3. 提出“真机 Reload”后，才加载设备规则。
4. 对同一成功 CI 分别比较 `npm run ci` 与 `npm run ci:agent` 的可见输出行数。

目标不是承诺固定 Token 百分比，而是验证三个可观察指标：常驻规则减少、默认检索不触及历史归档、成功 CI 输出降至十行以内。

## 10. 影响与回滚

本改动只影响 Agent 开发辅助文件、文档与本地命令，不修改 App 运行时代码、SQLite schema、原生依赖、权限、Bundle ID 或设备数据，不需要真机 Reload 或重装。

回滚时整体 revert 本 PR 即可。`npm run ci` 和 GitHub workflow 从未被替换，因此即使安静包装器存在问题，也不会削弱交付门禁。

## 11. 与现有 PR 的顺序

本瘦身工作使用独立分支和独立 PR，基于当前 `origin/main`。PR #25、#26、#27 在本工作完成前保持打开且不合并；瘦身 PR 合并后，它们分别同步新的 `main`，重新运行检查，再继续各自的验收或评审流程。
