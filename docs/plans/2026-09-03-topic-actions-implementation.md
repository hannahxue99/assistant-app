# Topic Actions Implementation Plan

**Goal:** 完成聚合主题置顶、改名/合并，并统一全 App 编辑入口。

**Architecture:** 主题置顶偏好独立存储在 `topic_preferences`；改名与合并通过 SQLite 独占事务保证一致性。UI 使用共享 `EditAction` 组件统一“铅笔进入、完成退出”，页面级和模块级只调整字号。

**Tech Stack:** Expo SDK 57、React Native 0.86、Expo Router、expo-sqlite、Ionicons、TypeScript。

---

### Task 1：设计稿与规范

- 更新 `design/topic-actions.svg`，覆盖置顶卡、主题编辑态和全局编辑控件。
- 更新 `DESIGN.md` 与主题设计说明，记录经典斜图钉和字号规则。
- 验证 SVG 可读取且文档引用正确。

### Task 2：共享编辑控件

- 新增 `src/components/EditAction.tsx`。
- 浏览态展示 `pencil-outline`；编辑态同位置展示“完成”。
- 页面级使用 20px 图标/15px 文字；模块级使用 18px 图标/13px 文字；点击区均为 44×44。

### Task 3：三个页面统一

- 用户原声详情页替换现有独立编辑按钮。
- 聚合详情页把铅笔移至右上导航区，删除主题行内“取消/完成”。
- 我的画像卡使用模块级共享控件，删除底部“保存画像”按钮。
- 聚合编辑返回时，有改动才提示丢弃。

### Task 4：验证与 PR

- 运行 `npm run typecheck`、主题排序、通知、待办及时间解析测试。
- 检查 Git diff，提交功能分支并创建 PR。
- 手机端验收：置顶/取消、改名、同名合并、三个页面编辑入口。

### Task 5：知识沉淀

- 记录主题级偏好建模、同名合并事务和编辑控件一致性经验。
- 更新 `docs/knowledge/INDEX.md` 并在 PR 中注明回滚点。
