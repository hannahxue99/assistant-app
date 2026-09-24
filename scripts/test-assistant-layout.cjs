const assert = require('node:assert/strict');
const fs = require('node:fs');

const assistantSource = fs.readFileSync('app/(tabs)/assistant.tsx', 'utf8');
const composerSource = fs.readFileSync('src/components/AssistantComposer.tsx', 'utf8');
const bubbleSource = fs.readFileSync('src/components/AssistantMessageBubble.tsx', 'utf8');
const markdownSource = fs.readFileSync('src/components/AssistantMarkdown.tsx', 'utf8');
const sourceListSource = fs.readFileSync('src/components/AssistantWebSources.tsx', 'utf8');
const llmSettingsSource = fs.readFileSync('app/settings/llm.tsx', 'utf8');

assert.match(
  assistantSource,
  /contentContainerStyle=\{styles\.keyboardStageContent\}[\s\S]*behavior=\{Platform\.OS === 'ios' \? 'position' : undefined\}/,
  'iOS 小知页必须用一个原生位移容器同步移动消息区和输入框',
);
assert.match(assistantSource, /<View style=\{styles\.header\}>[\s\S]*<KeyboardAvoidingView/,
  '标题区必须留在键盘位移容器外，键盘只移动对话正文和输入框');
assert.match(assistantSource, /enabled=\{keyboardMovementMode === 'following'\}[\s\S]*<FlatList/,
  '置底聚焦时外层必须移动消息列表');
assert.match(assistantSource, /<\/KeyboardAvoidingView>\s*<KeyboardAvoidingView[\s\S]*style=\{styles\.composerKeyboardStage\}[\s\S]*style=\{styles\.composerWrap\}/,
  '输入框必须使用页面根部的独立原生避让层，不能嵌套在消息区局部坐标中');
assert.doesNotMatch(assistantSource, /style=\{styles\.composerKeyboardStage\}[\s\S]{0,220}enabled=/,
  '输入框避让层必须在 following 和 history 两种模式下始终跟随键盘');
assert.match(assistantSource, /onInputFocus=\{\(\) => \{[\s\S]*setKeyboardMovementMode\(scrollModeRef\.current\);/,
  '键盘出现前必须冻结本轮 following/history 位移模式');
assert.doesNotMatch(assistantSource, /setKeyboardMovementMode\([^)]*\)[\s\S]*onScrollBeginDrag/,
  '键盘动画期间不得因列表拖动切换位移层级');
assert.match(assistantSource, /keyboardStage: \{ flex: 1, overflow: 'hidden' \}/,
  '整体上推时必须裁剪越过标题区的消息，避免覆盖固定标题');
assert.doesNotMatch(assistantSource, /Animated\.timing|keyboardScrollAnimationRef|animateBottomOffsetWithKeyboard/,
  '不得再用独立 JavaScript 滚动动画模拟正文与键盘同步');
assert.match(assistantSource, /onLayout=\{handleListLayout\}/,
  '消息区真实布局变化仍必须触发条件贴底');
assert.match(assistantSource, /onLayout=\{handleComposerLayout\}/,
  '输入框多行高度变化必须触发条件贴底');
assert.match(assistantSource, /ListFooterComponent=\{<View style=\{\{ height: composerHeight \+ 18 \}\} \/>\}/,
  '悬浮输入框必须用真实尾部占位保证最新消息可滚到输入框上方');
assert.doesNotMatch(assistantSource, /paddingBottom: composerHeight/,
  '不得依赖 FlatList 可能忽略的 contentContainer 底部 padding 作为滚动终点');
assert.match(assistantSource, /composerKeyboardStage: \{ position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: 0 \}/,
  '输入框避让层必须始终悬浮在消息区上方，不能形成独立底部面板');
assert.doesNotMatch(assistantSource, /keyboardVisible|composerWrapKeyboard|style=\{keyboardVisible/,
  '输入框不得在键盘出现时切换定位模式，避免首次聚焦丢失');
assert.doesNotMatch(assistantSource, /userReadingHistoryRef|followEndRef/,
  '不得保留含义重叠的历史阅读与贴底状态');
assert.match(assistantSource, /onScrollBeginDrag=\{\(\) => \{\s*userScrollInProgressRef\.current = true;/,
  '只有用户主动拖动消息区时才允许进入历史阅读状态');
assert.match(assistantSource, /onInputFocus=\{\(\) => \{\s*userScrollInProgressRef\.current = false;/,
  '输入框聚焦前必须清理可能因 Tab 切换遗留的拖动状态');
assert.match(assistantSource, /if \(fromUser\) \{\s*scrollModeRef\.current = nextPresentation\.atBottom \? 'following' : 'history';/,
  '只有用户手势滚动才能在贴底与历史阅读状态之间切换');
assert.doesNotMatch(assistantSource, /maintainVisibleContentPosition=/,
  '消息列表不得使用会在键盘缩短视口时抵消主动贴底的原生位置保持');
assert.match(assistantSource, /pendingPrependAnchorRef\.current = \{\s*contentHeight: metrics\.contentHeight,\s*offsetY: metrics\.offsetY/,
  '加载更早消息前必须记录当前内容高度和位置');
assert.match(assistantSource, /offset: prependAnchor\.offsetY \+ addedHeight/,
  '加载更早消息后必须手动补偿新增高度，保持原消息位置');
assert.match(assistantSource, /assistantScrollPresentation\(metrics\)/,
  '置底按钮与阴影必须共用同一份距离末端计算');
assert.match(assistantSource, /accessibilityLabel="回到最新消息"[\s\S]*onPress=\{jumpToLatest\}/,
  '离开底部后必须提供独立且可访问的置底按钮');
assert.match(assistantSource, /jumpToLatest: \{ position: 'absolute',[\s\S]*top: -49/,
  '置底按钮必须悬浮在输入框上方，不能参与消息或输入框布局');
assert.match(assistantSource, /composerShadowFade: \{[\s\S]*top: -58,[\s\S]*bottom: 0,[\s\S]*linear-gradient\(to bottom, rgba\(255,255,255,0\)/,
  '白色渐隐必须从输入框上方平滑延伸到底部，不能形成实色面板');
assert.match(composerSource, /elevation > 0 && styles\.composerElevated/,
  '滚动阴影必须保留在输入框卡片自身，不能因移除整宽渐变层而丢失');
assert.ok((assistantSource.match(/loadLatest\('if-following'\)/g) ?? []).length >= 3,
  '完成、停止和重试刷新都必须尊重用户是否仍在末端');
assert.doesNotMatch(assistantSource, /loadLatest\((true|false)\)/,
  '消息刷新不得继续使用含义不清的布尔贴底参数');
assert.match(assistantSource, /return \(\) => \{\s*mountedRef\.current = false;\s*Keyboard\.dismiss\(\);/,
  '切换 Tab 或离开小知时必须收起键盘');
assert.match(sourceListSource, /Keyboard\.dismiss\(\);\s*await WebBrowser\.openBrowserAsync/,
  '打开网页来源前必须收起键盘');
assert.match(llmSettingsSource, /‹ 返回/,
  '理解引擎可从多个入口进入，返回文案不得错误指向“我的”');
assert.match(bubbleSource, /<AssistantMarkdown content=\{message\.content\} streaming=\{isStreaming\} \/>/,
  '小知最终回复正文必须使用受控 Markdown 渲染');
assert.match(bubbleSource, /styles\.userContent\]}>{message\.content}<\/Text>/,
  '用户消息必须继续按纯文本渲染');
assert.match(markdownSource, /case 'html':[\s\S]*return null;/,
  'Markdown 原始 HTML 不得渲染或执行');
assert.match(markdownSource, /case 'image':[\s\S]*\[图片：\{node\.alt\}\]/,
  'Markdown 图片不得发起远程加载，只允许展示替代文字');
assert.match(markdownSource, /safeAssistantMarkdownLink\(node\.url \?\? ''\)/,
  'Markdown 链接必须先经过 HTTP\(S\) 安全校验');

console.log('assistant keyboard and navigation layout tests passed');
