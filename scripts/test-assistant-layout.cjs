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
  /behavior=\{Platform\.OS === 'ios' \? 'height' : undefined\}/,
  'iOS 小知页必须缩短有效高度，让绝对定位输入框停在键盘上方',
);
assert.match(assistantSource, /onLayout=\{handleListLayout\}/,
  '消息区可视高度变化必须触发条件贴底');
assert.match(assistantSource, /onLayout=\{handleComposerLayout\}/,
  '输入框多行高度变化必须触发条件贴底');
assert.match(assistantSource, /ListFooterComponent=\{<View style=\{\{ height: composerHeight \+ 18 \}\} \/>\}/,
  '悬浮输入框必须用真实尾部占位保证最新消息可滚到输入框上方');
assert.doesNotMatch(assistantSource, /paddingBottom: composerHeight/,
  '不得依赖 FlatList 可能忽略的 contentContainer 底部 padding 作为滚动终点');
assert.match(assistantSource, /composerWrap: \{ position: 'absolute', zIndex: 10/,
  '输入框必须始终使用线上悬浮结构，不能形成独立底部面板');
assert.doesNotMatch(assistantSource, /keyboardVisible|composerWrapKeyboard|style=\{keyboardVisible/,
  '输入框不得在键盘出现时切换定位模式，避免首次聚焦丢失');
assert.match(assistantSource, /followEndOnKeyboardOpenRef\.current = scrollModeRef\.current === 'following'/,
  '输入框聚焦时必须按单一滚动模式决定键盘跟随，不能被布局滚动误判');
assert.doesNotMatch(assistantSource, /userReadingHistoryRef|followEndRef/,
  '不得保留含义重叠的历史阅读与贴底状态');
assert.match(assistantSource, /onScrollBeginDrag=\{\(\) => \{\s*userScrollInProgressRef\.current = true;/,
  '只有用户主动拖动消息区时才允许进入历史阅读状态');
assert.match(assistantSource, /onScrollBeginDrag=\{\(\) => \{[\s\S]*keyboardAnchorRef\.current = \{ active: false, following: false \};/,
  '键盘过渡期间真实拖动必须立即取消自动置底，让用户手势优先');
assert.match(assistantSource, /onInputFocus=\{\(\) => \{\s*userScrollInProgressRef\.current = false;/,
  '输入框聚焦前必须清理可能因 Tab 切换遗留的拖动状态');
assert.match(assistantSource, /if \(fromUser\) \{\s*scrollModeRef\.current = nextPresentation\.atBottom \? 'following' : 'history';/,
  '只有用户手势滚动才能在贴底与历史阅读状态之间切换');
assert.match(assistantSource, /Keyboard\.addListener\('keyboardDidShow',[\s\S]*keepLatestVisibleAfterLayout\(\)/,
  '键盘完全出现后，原本位于末端的消息必须重新贴到输入框上方');
assert.match(assistantSource, /Keyboard\.addListener\('keyboardWillShow',[\s\S]*keyboardAnchorRef\.current = \{[\s\S]*active: true,[\s\S]*following: shouldFollow/,
  'iOS 键盘动画开始前必须冻结置底意图，不能等布局变化后再猜测');
assert.match(assistantSource, /assistantBottomOffset\(\{[\s\S]*contentHeight: metrics\.contentHeight,[\s\S]*viewportHeight: metrics\.viewportHeight/,
  '键盘过渡必须按最终内容与视口几何计算唯一置底位置');
assert.match(assistantSource, /listRef\.current\?\.scrollToOffset\(\{[\s\S]*offset: assistantBottomOffset/,
  '底部锚点事务必须使用精确 offset，不能只靠延迟 scrollToEnd');
assert.match(assistantSource, /Keyboard\.addListener\('keyboardDidShow',[\s\S]*settleKeyboardAnchor\(\)/,
  '键盘完全出现后必须做一次无动画收敛，消除动画取整误差');
assert.match(assistantSource, /if \(shouldFollow\) keepLatestVisibleAfterLayout\(\)/,
  '只有原本位于末端时才跟随键盘上移，历史阅读位置必须保持不动');
assert.match(assistantSource, /Keyboard\.addListener\('keyboardDidHide',[\s\S]*scrollModeRef\.current === 'following';[\s\S]*keepLatestVisibleAfterLayout\(\)/,
  '键盘收起并恢复页面高度后，原本位于末端的消息必须再次校正贴底，不能留下空白');
assert.match(assistantSource, /const shouldPinForKeyboard = followEndOnKeyboardOpenRef\.current === true[\s\S]*if \(shouldPinForKeyboard\) keepLatestVisibleAfterLayout\(\)/,
  '键盘开合改变可视高度的整个过程都必须保持末端，不得只在弹起完成时校正一次');
assert.match(assistantSource, /followEndOnKeyboardOpenRef\.current = nextPresentation\.atBottom/,
  '键盘内手动滚回末端后必须恢复收键盘时的贴底校正');
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
