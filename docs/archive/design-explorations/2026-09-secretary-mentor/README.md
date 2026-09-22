# 2026-09 秘书 + 导师早期设计探索

状态：历史归档，不作为当前实现依据。

这些图稿形成于 2026-09-09 至 2026-09-13，用于探索“秘书 + 导师”产品定位、临时对话入口、三 Tab 信息架构、Token 预算和旧理解引擎的演进方向。它们保留了决策形成过程，但部分内容已被后续产品决策取代。

当前实现与后续设计应以仓库根目录的 `PRD.md`、对应功能的最新 `docs/plans/` 设计文档以及 `docs/knowledge/INDEX.md` 为准。当前有效的信息架构是：

- 首页：待办、事件，以及后续计划中的教练提醒。
- 小知：连续对话、理解与安全执行中心。
- 我的：长期记忆、设置、权限和数据管理。

归档文件：

- `secretary-mentor-interaction-v04.svg`：秘书回执与导师追问的早期交互探索。
- `secretary-mentor-integration-v05.svg`：在旧首页上增量加入对话页的过渡方案。
- `secretary-mentor-information-architecture-v06.svg`：今天 / 对话 / 记忆的早期信息结构。
- `secretary-mentor-three-tabs-v07.svg`：今天 / 记忆 / 我的替代 Tab 方案；未采用。
- `token-budget-architecture-v08.svg`：上下文预算和增量沉淀的早期分析，原则仍有参考价值。
- `llm-unified-understanding-v10.svg`：旧记录理解引擎的一次响应扩展方案，已被小知统一协议演进取代。

归档规则：后续代理默认不读取本目录；只有追溯历史决策或比较被否决方案时才按文件名定向读取。
