# V1 Product Baseline Documentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将原“秘书 + 导师”V0.3 完整愿景正式升级为 V1 产品定义，并清楚区分 V1 目标能力与当前实现进度。

**Architecture:** 不改变运行时代码和数据结构。本次以 `PRD.md` 作为 V1 产品事实来源，README 提供简版入口，历史设计文档保留决策来源并标注版本映射，知识库记录版本口径和后续维护规则。

**Tech Stack:** Markdown、SVG、Git、现有 Expo 57 项目验证命令。

---

### Task 1: 建立 V1 总览图与产品事实来源

**Files:**
- Create: `design/v1-product-overview.svg`
- Modify: `PRD.md`

**Step 1:** 将已确认的“完整愿景即 V1”画成产品闭环图，图中同时标注目标能力与当前交付状态。

**Step 2:** 重写 `PRD.md`，包含定位、信息架构、四类数据、主链路、主动导师闭环、技术原则、边界、进度矩阵和验收标准。

**Step 3:** 检查 PRD 不把未实现的每日复盘、教练提醒和统一搜索描述为已经上线。

### Task 2: 统一项目入口与历史文档口径

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-09-13-secretary-mentor-v03-design.md`
- Modify: `docs/plans/2026-09-10-secretary-mentor-working-decisions.md`
- Modify: `docs/knowledge/secretary-mentor-v03-release.md`
- Modify: `docs/knowledge/INDEX.md`
- Create: `docs/knowledge/v1-product-baseline.md`

**Step 1:** README 首屏改为 V1 定位、完整闭环和当前进度，移除旧“快速记录工具”总纲。

**Step 2:** 历史 V0.3 文档保留文件名以维持链接，但正文明确其完整愿景现正式命名为 V1。

**Step 3:** 知识库记录版本命名决策、目标与实现状态分离原则、验证方法和回滚点。

### Task 3: 验证并交付

**Files:**
- Verify: all files above

**Step 1:** 用 `rg` 检查 V0.3 引用是否都带历史解释，检查 README/PRD/知识索引链接。

**Step 2:** 运行 `npm run ci`，预期类型检查和全部自动测试通过。

**Step 3:** 审查 Git diff，确认仅包含文档和设计资产，没有运行时代码或版本号误改。

**Step 4:** 提交分支并创建 PR；PR 说明 V1 是完整目标，当前仅交付主要功能。
