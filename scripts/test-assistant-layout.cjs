const assert = require('node:assert/strict');
const fs = require('node:fs');

const assistantSource = fs.readFileSync('app/(tabs)/assistant.tsx', 'utf8');
const composerSource = fs.readFileSync('src/components/AssistantComposer.tsx', 'utf8');
const bubbleSource = fs.readFileSync('src/components/AssistantMessageBubble.tsx', 'utf8');
const receiptSource = fs.readFileSync('src/components/AssistantActionReceipt.tsx', 'utf8');
const markdownSource = fs.readFileSync('src/components/AssistantMarkdown.tsx', 'utf8');
const sourceListSource = fs.readFileSync('src/components/AssistantWebSources.tsx', 'utf8');
const llmSettingsSource = fs.readFileSync('app/settings/llm.tsx', 'utf8');
const tabsSource = fs.readFileSync('app/(tabs)/_layout.tsx', 'utf8');
const homeSource = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const profileSource = fs.readFileSync('app/(tabs)/profile.tsx', 'utf8');
const mascotSource = fs.readFileSync('src/components/XiaozhiMascot.tsx', 'utf8');

assert.match(homeSource, /accessibilityLabel="小知正在关注"/,
  '首页必须保留生成图中的“小知正在关注”主视觉区');
assert.match(homeSource, /<XiaozhiMascot size=\{92\}/,
  '首页标题区必须使用可复用的小知 3D 形象');
assert.match(homeSource, /有我在，\{`\\n`\}一切井井有条。/,
  '首页标题区必须保留小知左侧的陪伴文案');
assert.match(homeSource, /events\.map\(\(event, index\) =>/,
  '“小知正在关注”必须直接展示完整事件列表');
assert.doesNotMatch(homeSource, /spotlightEvent|recentEvents|最近事件|watchingCard/,
  '首页不得再拆分重点事件和最近事件');
assert.ok(homeSource.includes('本周待办') && homeSource.includes('全部待办'),
  '首页待办筛选必须并列展示“本周待办｜全部待办”');
assert.doesNotMatch(homeSource, /查看全部|持续事件/,
  '首页不得显示旧的“查看全部”或“持续事件”文案');
assert.ok(homeSource.includes('EVENT_VISUAL_RULES')
  && homeSource.includes('hardware-chip-outline')
  && homeSource.includes('EVENT_VISUAL_FALLBACKS'),
  '事件图标必须根据内容匹配，并提供丰富的兜底图标');
assert.match(homeSource, /hero: \{ minHeight: 82, position: 'relative' \}/,
  '首页待办必须紧接头部，不得由小知图片撑开大段留白');
assert.match(homeSource, /todoSection: \{ gap: 10 \}/,
  '首页待办卡与本周待办标题之间必须保留清晰留白');
assert.match(homeSource, /weekRow: \{[\s\S]*minHeight: 50,[\s\S]*paddingVertical: 4/,
  '首页待办卡必须保持小巧紧凑');
assert.match(homeSource, /eventsSection: \{ gap: 2, marginTop: 10 \}/,
  '小知正在关注与待办卡之间必须保留清晰留白');
assert.match(homeSource, /eventTitle: \{[^\n]*fontSize: 18,[^\n]*lineHeight: 24/,
  '事件标题字号必须提升');
assert.match(homeSource, /eventState: \{[^\n]*fontSize: 15,[^\n]*lineHeight: 20/,
  '事件内容字号必须提升');
assert.match(homeSource, /eventTime: \{[^\n]*fontSize: 13,[^\n]*lineHeight: 18/,
  '事件时间字号必须提升');
assert.match(profileSource, /管理你的记忆与偏好，让小知更懂你。/,
  '我的页必须保留生成图中的页面说明');
assert.match(profileSource, /<XiaozhiMascot size=\{84\}/,
  '我的页标题区必须使用可复用的小知 3D 形象');
assert.doesNotMatch(profileSource, /speechBubble|记得你|个性化小知的能力与提醒方式。/,
  '我的页右侧只保留小知图标，设置标题不带说明');
assert.match(profileSource, /<Text numberOfLines=\{1\} style=\{styles\.pageSubtitle\}>/,
  '我的页说明必须保持单行');
assert.match(profileSource, /hero: \{ minHeight: 80, position: 'relative' \}/,
  '我的页外层顶距加头部高度必须与小知页头部总高一致');
assert.match(profileSource, /heroCopy: \{ flex: 1, paddingTop: 8, gap: 5 \}/,
  '我的页标题与第二行间距必须和小知页一致');
assert.match(profileSource, /pageSubtitle: \{[^\n]*marginTop: 1 \}/,
  '我的页第二行微调必须和小知页说明位置一致');
assert.match(profileSource, /heroAssistant: \{ position: 'absolute', top: -6, right: -7, width: 84/,
  '我的页右上角小知必须固定显示，不得被副标题挤出');
assert.equal((profileSource.match(/style=\{styles\.settingsCard\}/g) ?? []).length, 3,
  '三个设置分组必须复用助手与同步的卡片样式');
assert.doesNotMatch(profileSource, /notifyCard|dataCard|notifyRow|\bdataRow\b/,
  '设置区不得保留与助手与同步不一致的卡片样式');
assert.match(assistantSource, /连续对话 · 自动保存/,
  '小知页必须保留生成图中的会话说明');
assert.match(assistantSource, /<XiaozhiMascot size=\{84\}/,
  '小知页标题区必须使用可复用的小知 3D 形象');
assert.doesNotMatch(assistantSource, /speechBubble|打开决策日志调试页|terminal-outline/,
  '小知页右侧只保留小知图标，不暴露调试入口');
assert.match(assistantSource, /header: \{ minHeight: 90, position: 'relative', paddingHorizontal: 20, paddingTop: 10/,
  '小知页消息列表必须紧接压缩后的标题区');
assert.match(assistantSource, /headerCopy: \{ paddingTop: 8,[^\n]*\}[\s\S]*headerAssistant: \{ position: 'absolute', top: 4, right: 13/,
  '小知页右上角图标必须与左侧标题顶线对齐');
for (const [name, source] of [['首页', homeSource], ['小知页', assistantSource], ['我的页', profileSource]]) {
  assert.doesNotMatch(source, /WarmAmbientBackground/,
    `${name}必须使用纯白背景，不得叠加暖色氛围层`);
  assert.match(source, /safe: \{ flex: 1, backgroundColor: '#FFFFFF' \}/,
    `${name}页面底色必须为纯白`);
}
assert.match(mascotSource, /xiaozhi-mascot\.png/,
  '三个页面必须复用项目内的小知形象资产');
assert.match(mascotSource, /defaultSource=\{xiaozhiMascotSource\}/,
  '小知形象必须使用同一本地图片作为原生占位，避免页面挂载时出现空白帧');
assert.match(mascotSource, /fadeDuration=\{0\}/,
  '小知形象不得在页面切换时重复淡入');

assert.match(
  assistantSource,
  /const keyboard = useAnimatedKeyboard\(\);[\s\S]*const keyboardLift = useDerivedValue/,
  '小知页必须直接订阅系统键盘实时帧，不能另起布局动画',
);
assert.match(assistantSource, /keyboard\.height\.value - composerClosedBottomGap\.value/,
  '键盘位移必须扣除输入框关闭态到底部屏幕的固定间隙');
assert.match(assistantSource, /const conversationKeyboardStyle = useAnimatedStyle\([\s\S]*keyboardMovementMode === 'following' \? -keyboardLift\.value : 0/,
  '只有置底模式才允许正文跟随键盘实时位移');
assert.match(assistantSource, /const composerKeyboardStyle = useAnimatedStyle\([\s\S]*translateY: -keyboardLift\.value/,
  '输入框必须在两种阅读模式下复用同一份键盘实时位移');
assert.match(assistantSource, /<View style=\{styles\.header\}>[\s\S]*<Animated\.View style=\{\[styles\.keyboardStage, conversationKeyboardStyle\]\}/,
  '标题区必须留在键盘位移容器外，键盘只移动对话正文和输入框');
assert.match(assistantSource, /<\/Animated\.View>\s*<Animated\.View[\s\S]*style=\{\[styles\.composerKeyboardStage, composerKeyboardStyle\]\}/,
  '输入框必须使用页面根部的独立实时位移层，不能嵌套在消息区局部坐标中');
assert.doesNotMatch(assistantSource, /KeyboardAvoidingView/,
  '正文和输入框不得再各自提交 KeyboardAvoidingView 动画');
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
assert.match(composerSource, /borderColor: '#E7DED6',[\s\S]*backgroundColor: '#FFFFFF'/,
  '输入框必须用清晰但克制的边界与暖白卡片底色形成基础层次');
assert.match(composerSource, /shadowColor: '#6E5E52',[\s\S]*shadowOpacity: 0\.12,[\s\S]*shadowRadius: 16,[\s\S]*shadowOffset: \{ width: 0, height: 6 \}/,
  '输入框在置底状态也必须保留轻微外凸阴影');
assert.match(composerSource, /shadowOpacity: 0\.10 \+ 0\.06 \* elevation/,
  '用户离开底部时，输入框阴影必须从基础外凸连续增强');
assert.match(bubbleSource, /content: \{ color: theme\.colors\.text, fontSize: 16, lineHeight: 23 \}/,
  '用户发送后的消息气泡必须使用 16px 正文');
assert.doesNotMatch(bubbleSource, /styles\.avatar|<XiaozhiMascot/,
  '小知回复不得保留头像占位造成右缩进');
assert.ok(bubbleSource.includes("assistantBubble: {\n    width: '100%',"),
  '小知回复内容必须使用消息卡全部可用宽度');
assert.match(bubbleSource, /assistantMessageLine: \{ width: '94%'/,
  '小知回复卡必须与已处理卡使用相同宽度');
assert.match(bubbleSource, /assistantBubble: \{[\s\S]*backgroundColor: theme\.colors\.card,[\s\S]*borderColor: theme\.colors\.border/,
  '小知回复卡必须与已处理卡使用相同白底和边框色');
assert.match(receiptSource, /wrap: \{[\s\S]*width: '100%',[\s\S]*backgroundColor: theme\.colors\.card,[\s\S]*borderColor: theme\.colors\.border/,
  '已处理卡必须保留统一卡片底色和边框');
assert.match(bubbleSource, /receiptWrap: \{ width: '94%'/,
  '已处理卡外层宽度必须与小知回复卡一致');
assert.match(markdownSource, /body: \{ color: theme\.colors\.text, fontSize: 16, lineHeight: 23 \}/,
  '小知最终回复正文必须使用 16px');
assert.match(markdownSource, /listMarker: \{ width: 18, color: theme\.colors\.text, fontSize: 16, lineHeight: 23 \}/,
  'Markdown 列表标记必须与 16px 回复正文对齐');
assert.match(tabsSource, /sceneStyle: styles\.scene/,
  '首页、小知、我的三个 Tab 场景必须统一使用纯白背景');
assert.match(tabsSource, /tabBarBackground: \(\) => <View style=\{styles\.tabBarBackground\} \/>/,
  '底部 Tab Bar 必须使用实体背景，不能透出系统灰色或模糊材质');
assert.match(tabsSource, /tabBarLabel: \(\) => null/,
  '小知底部 Tab 必须隐藏“小知”文字');
assert.match(tabsSource, /<XiaozhiMascot size=\{64\} \/>/,
  '小知底部 Tab 必须复用页面顶部的小知形象');
assert.doesNotMatch(tabsSource, /size=\{focused \?/,
  '小知底部图标切换选中态时不得改变布局尺寸');
assert.match(tabsSource, /xiaozhiTabSlot: \{ width: 70, height: 54,[^\n]*overflow: 'visible' \}/,
  '小知底部图标必须使用固定且不裁剪的布局槽');
assert.match(tabsSource, /xiaozhiTabIcon: \{ width: 70, height: 54, marginTop: -1,[^\n]*overflow: 'visible' \}/,
  '小知底部图标槽必须上移到与其他 Tab 的底边基线一致');
assert.match(tabsSource, /xiaozhiTabGlyph: \{ position: 'absolute', bottom: 0,[^\n]*transformOrigin: 'center bottom' \}/,
  '小知底部图标必须固定底边，选中时只向上放大');
assert.match(tabsSource, /xiaozhiTabGlyphFocused: \{ transform: \[\{ scale: 1\.28 \}\] \}/,
  '小知底部图标选中态必须仅通过缩放形成明显差异');
assert.doesNotMatch(tabsSource, /XiaozhiEyesIcon/,
  '小知底部 Tab 不得继续使用旧眼睛图标');
assert.match(tabsSource, /scene: \{ backgroundColor: '#FFFFFF' \}[\s\S]*tabBarBackground: \{ flex: 1, backgroundColor: '#FFFFFF' \}/,
  '三个 Tab 页面与底部导航必须使用纯白背景');
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
