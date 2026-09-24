# 小知移动端输入区、滚动状态与 Markdown 回复

## 背景与最终决策

PR #31 在固定 Release CMake 工具链之外，收口了小知移动端连续出现的输入框遮挡、键盘贴底、历史位置跳动、底部层级和回复格式问题。

最终产品决策：

- 输入框始终是一张绝对定位的悬浮卡片，不切换为独立底部面板。
- 页面只有 `following / history` 一套滚动模式。默认进入末端；用户主动上滑才进入历史模式。
- 历史模式显示圆形置底按钮。历史位置点击输入框只拉起键盘，不滚到末端；点击按钮或发送消息才回到底部。
- 白色渐隐、输入框阴影和置底按钮都由距离末端的同一份计算驱动。
- 仅小知最终回复正文启用受控 Markdown；用户消息、思考过程、处理状态、来源与回执继续使用原组件。
- 首页、小知、我的统一白色页面底色；事件卡和开关沿用统一主题色。

非目标：

- 不让 Markdown 影响业务协议或数据库内容。
- 不在回复中执行 HTML、加载远程图片、渲染表格或打开非 HTTP(S) 链接。
- 不改变数据库 schema、原生权限、生产 Bundle ID 或 Dev/Release 数据隔离。

## 根因与技术取舍

### 键盘与贴底

旧实现把键盘、内容增长和导航返回都压在多个含义重叠的布尔 ref 上，同时使用 `maintainVisibleContentPosition` 和程序化 `scrollToEnd`。键盘缩短视口时，原生位置保持与主动贴底会互相抵消；绝对定位输入框又需要真实尾部空间，单靠 `contentContainerStyle.paddingBottom` 不能稳定定义滚动终点。

修复方式：

1. iOS `KeyboardAvoidingView` 使用 `height`，输入框仍绝对定位在有效页面底部。
2. `ListFooterComponent` 提供与输入框真实高度一致的末端占位。
3. 用户手势是进入 `history` 的唯一入口；程序布局变化不修改阅读模式。
4. 键盘聚焦时快照当前模式：`following` 才在布局完成后校正末端，`history` 完全不调用 `scrollToEnd`。
5. 加载更早消息前记录内容高度和 offset，加载后补偿新增高度，代替会与键盘冲突的原生位置保持。
6. 回复落库、停止和重试使用 `always / if-following / never` 明确表达贴底意图。

### Markdown

模型自然使用 Markdown 组织长回答，纯文本 `Text` 会暴露 `**` 和 `-`。不采用“提示词禁止 Markdown”或正则删除标记：前者不可靠，后者会破坏嵌套列表、转义和代码。

采用维护中的 `mdast-util-from-markdown` 生成 CommonMark 语法树，再由本地 React Native 组件受控渲染。最初评估的旧 React Native Markdown 包会引入带已知高危复杂度漏洞的旧解析链，因此未采用。原始 Markdown 继续落库，历史消息无需迁移；组件禁用 HTML，图片仅展示替代文字，链接复用本地 HTTP(S) 与凭据校验。

## 可复用规则

- 聊天页把“用户阅读意图”和“当前几何距离”分开：模式决定是否允许程序滚动，距离只决定视觉呈现。
- 键盘动画中不要用临时 viewport 反推用户意图；聚焦前快照比 `keyboardDidShow` 后猜测可靠。
- 悬浮输入区必须在列表末端提供真实占位；渐变层与置底按钮都应绝对定位，不能影响输入框测量高度。
- 模型正文保存原始 Markdown，展示层做受控解析；业务状态文案保持结构化组件，不交给 Markdown。
- 引入文本解析依赖前检查传递依赖和审计结果；即使功能可用，也不要把已知高危解析链带入产品。

## 验证与验收

- `npm run test:assistant-layout`
- `npm run test:assistant-ui`
- `npm run test:assistant-composer`
- `npm run test:assistant-markdown`
- `npm run typecheck`
- `npm run ci`
- Metro iOS Bundle：成功，1645 modules。
- 私人助手 Dev 物理 iPhone 验收：默认贴底、键盘弹起、历史位置不跳底、置底按钮、距离渐隐/阴影、最终回复 Markdown；用户于 2026-09-24 确认验收通过。

## 发布与回滚

- PR：#31。
- 分支：`codex/release-cmake-fixed-toolchain`。
- 发布前基线 / 整体回滚点：`6b48994dcc279b8f64abdbd9cf37876095e7c5a9`。
- 无数据库迁移、原生权限或 Bundle ID 变化；生产 Release 使用同一 `com.huanxue.assistantapp` 覆盖安装，保留现有沙盒数据。
- UI/Markdown 局部回滚可撤销 PR #31 中对应独立提交；固定 CMake 工具链提交应保留，避免 Release 再次回退到系统 CMake 3.5.2。

