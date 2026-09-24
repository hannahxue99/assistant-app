# 小知最终回复 Markdown 渲染实施计划

1. 引入纯 JavaScript 的 React Native Markdown 渲染依赖，不增加原生配置。
2. 新增独立 `AssistantMarkdown` 组件，统一主题样式、安全链接和禁用节点规则。
3. 仅替换小知最终回复正文的纯文本渲染，保留用户消息和其他中间信息。
4. 增加结构测试与安全边界测试，并纳入聚合 `npm test`。
5. 运行小知 UI、布局、Markdown 专项测试和 TypeScript 检查。
6. 通过现有 Dev Metro Reload 验收加粗、长列表、链接、流式回复和键盘滚动组合场景。

