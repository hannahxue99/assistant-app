import {
  assistantFailureLabel,
  canLoadOlderAssistantMessages,
  canRetryAssistantMessage,
  hasPendingAssistantReply,
  isAssistantComposerDisabled,
  mergeAssistantMessages,
  pendingAssistantRequestId,
  assistantReceiptState,
  assistantReceiptTarget,
  assistantTodoNavigationIntent,
  groupAssistantReceiptOperations,
  listStateWhileRefreshing,
  shouldScrollAssistantOnFocus,
  shouldFollowAssistantEnd,
  assistantComposerElevation,
  assistantBottomOffset,
  assistantScrollPresentation,
  assistantMessageSurface,
  shouldMaintainAssistantEndAfterLayout,
  shouldScrollAssistantAfterRefresh,
} from '../src/assistant/ui-state';
import { ASSISTANT_EMPTY_DESCRIPTION } from '../src/assistant/ui-copy';
import {
  assistantCompletedRuntimeLabel,
  assistantRuntimeLabel,
  formatAssistantRuntimeDuration,
} from '../src/assistant/runtime-state';
import {
  formatAssistantDateSeparator,
  formatAssistantMessageTime,
  shouldShowAssistantDateSeparator,
} from '../src/assistant/message-time';
import {
  assistantStageDurationsFromTimeline,
  assistantStageLineLabel,
  assistantStageSummaryLabel,
} from '../src/assistant/runtime-state';
import type { AssistantMessage } from '../src/assistant/types';
import type { AssistantOperation } from '../src/assistant/action-types';
import {
  assistantWebSourceHost,
  assistantWebSourcesLabel,
  safeAssistantWebSourceUrl,
} from '../src/assistant/web-source-ui';

const NOW = new Date(2026, 8, 15, 12, 0).getTime();
const DAY = 24 * 3600 * 1000;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function message(id: string, createdAt: number, content = id): AssistantMessage {
  return {
    id,
    requestId: `request-${id}`,
    role: 'user',
    content,
    source: 'text',
    status: 'saved',
    segmentId: 'segment',
    createdAt,
    updatedAt: createdAt,
    legacyEntryId: null,
    errorCode: null,
  };
}

const current = [message('b', 2), message('c', 3, '旧内容')];
const latest = [message('c', 3, '新内容'), message('d', 4)];
const merged = mergeAssistantMessages(current, latest);
check(merged.map(item => item.id).join(',') === 'b,c,d', '刷新时必须去重并按稳定时间顺序合并');
check(merged[1].content === '新内容', '相同 id 应采用 updatedAt 不更旧的版本');

const transientRuntime = {
  ...message('runtime', 5),
  role: 'assistant' as const,
  runtimeStage: 'answering' as const,
  runtimeStartedAt: 1,
};
const refreshedRuntime = mergeAssistantMessages(
  [transientRuntime],
  [{ ...transientRuntime, runtimeStage: undefined, runtimeStartedAt: undefined }],
)[0];
check(refreshedRuntime.runtimeStage === 'answering' && refreshedRuntime.runtimeStartedAt === 1,
  '数据库刷新不得抹掉当前进程内的流式计时状态');

const sameTime = mergeAssistantMessages([message('z', 10)], [message('a', 10)]);
check(sameTime.map(item => item.id).join(',') === 'a,z', '同一时间使用 id 保证稳定顺序');

check(
  ASSISTANT_EMPTY_DESCRIPTION === '我会记住前后文，陪你把事情一步步理清。',
  '首次进入说明应使用已确认的用户语言',
);
check(!/记录|待办|困惑/.test(ASSISTANT_EMPTY_DESCRIPTION), '首次进入说明不应暴露内部分类');

const oldFailure = { ...message('old-failed', 20), status: 'failed' as const, errorCode: 'network' };
const latestFailure = { ...message('latest-failed', 21), status: 'failed' as const, errorCode: 'timeout' };
const failures = [oldFailure, latestFailure];
check(!canRetryAssistantMessage(oldFailure, failures, 'configured'), '有更新消息后，旧失败不得重试');
check(canRetryAssistantMessage(latestFailure, failures, 'configured'), '最新失败消息应允许重试');
check(assistantFailureLabel(oldFailure, false) === '这条未回复', '旧失败只保留未回复状态');
check(assistantFailureLabel(latestFailure, true) === '小知暂时没回复 · 重试', '网络或超时应给局部重试');

const interrupted = { ...message('interrupted', 22), status: 'failed' as const, errorCode: 'interrupted' };
check(assistantFailureLabel(interrupted, true) === '上次回复被中断 · 重试', '冷启动中断应使用可理解文案');
const missingKey = { ...message('missing-key', 23), status: 'failed' as const, errorCode: 'missing-key' };
check(!canRetryAssistantMessage(missingKey, [missingKey], 'unconfigured'), '未配置时不应提供无效重试');
check(canRetryAssistantMessage(missingKey, [missingKey], 'configured'), '配置完成后应允许重试原消息');
check(assistantFailureLabel(missingKey, false) === '尚未回复', '未配置时只说明尚未回复');

const sending = { ...message('sending', 24), status: 'sending' as const };
check(hasPendingAssistantReply([sending]), '发送中的用户消息应标记为等待回复');
check(pendingAssistantRequestId([message('older', 23), sending]) === sending.requestId,
  '停止按钮必须绑定当前发送中的请求');
check(!hasPendingAssistantReply([latestFailure]), '失败消息不应继续标记为等待回复');
check(isAssistantComposerDisabled('loading', []), '首次加载期间输入应禁用');
check(isAssistantComposerDisabled('error', []), '首次加载失败时输入应禁用');
check(!isAssistantComposerDisabled('ready', [sending]), '有回复处理中时输入仍应允许编辑草稿');
check(!isAssistantComposerDisabled('ready', [latestFailure]), '回复失败后输入应恢复');
check(formatAssistantRuntimeDuration(8_999) === '8 秒', '一分钟内运行时间应按整秒展示');
check(formatAssistantRuntimeDuration(68_999) === '1 分 08 秒', '一分钟后应切换为分秒展示');
check(assistantRuntimeLabel('planning', 68_000) === '小知正在整理处理方案 · 1 分 08 秒',
  '思考状态应展示连续运行时间');
check(assistantRuntimeLabel('reading', 9_000) === '小知正在读取事件和待办 · 9 秒',
  '调用数据工具时应明确展示读取状态');
check(assistantRuntimeLabel('searching', 12_000) === '小知正在搜索网页 · 12 秒',
  '联网时应明确展示搜索网页状态');
check(assistantRuntimeLabel('updating', 70_000) === '小知正在更新 · 1 分 10 秒',
  '本地事务执行时应明确展示更新状态');
check(assistantRuntimeLabel('answering', 72_000) === '小知正在回答 · 1 分 12 秒',
  '开始流式回答后只切换阶段文案，不重置计时');
check(assistantRuntimeLabel('finalizing', 80_000) === '小知正在整理 · 1 分 20 秒',
  '本地校验提交阶段应继续沿用同一运行时间');

check(assistantStageLineLabel('reading', 3_000) === '读取事件和待办 3 秒',
  '运行中已定格阶段应显示阶段名与耗时');
check(assistantStageLineLabel('planning', 8_500) === '整理处理方案 8 秒',
  '已定格阶段的耗时按整秒展示');

const timeline = [
  { stage: 'planning' as const, at: 1_000 },
  { stage: 'searching' as const, at: 2_000 },
  { stage: 'reading' as const, at: 4_000 },
  { stage: 'planning' as const, at: 7_000 },
  { stage: 'updating' as const, at: 13_000 },
  { stage: 'answering' as const, at: 14_000 },
];
const mergedStages = assistantStageDurationsFromTimeline(timeline, 20_000);
check(mergedStages.thinkingMs === 7_000 && mergedStages.searchingMs === 2_000
  && mergedStages.readingMs === 3_000 && mergedStages.updatingMs === 1_000,
  '同阶段多段时间线必须合并累加，忽略回答与收尾');

check(assistantStageSummaryLabel({ readingMs: 3_000, searchingMs: 2_000, thinkingMs: 8_000, updatingMs: 1_000 })
  === '读取 3 秒 · 搜索 2 秒 · 思考 8 秒 · 更新 1 秒',
  '落定摘要应按阶段顺序拼接实际耗时');
check(assistantStageSummaryLabel({ thinkingMs: 6_000 }) === '思考了 6 秒',
  '纯聊天轮应退化为思考了 X 秒');
check(assistantStageSummaryLabel(undefined, 7_000) === '思考了 7 秒',
  '旧消息无阶段耗时时回退到思考时长');
check(assistantStageSummaryLabel({ readingMs: 400, updatingMs: 300 }) === null,
  '各阶段耗时不足一秒时不显示摘要行');
check(assistantStageSummaryLabel({ readingMs: 3_000, thinkingMs: 8_000 })
  === '读取 3 秒 · 思考 8 秒',
  '未发生的阶段不得出现在摘要行');
check(assistantCompletedRuntimeLabel(84_000) === '用时 1 分 24 秒',
  '完成后应弱化展示本轮总用时');
check(assistantWebSourcesLabel(3) === '搜索来源 3', '来源入口应显示实际数量并默认由组件折叠');
check(safeAssistantWebSourceUrl('https://example.com/doc#part') === 'https://example.com/doc#part',
  'HTTP(S) 来源应允许交给系统浏览器打开');
check(safeAssistantWebSourceUrl('file:///etc/passwd') === null
  && safeAssistantWebSourceUrl('https://user:pass@example.com') === null,
  '本地协议或带凭据的来源不得打开');
check(assistantWebSourceHost({ title: '示例', url: 'https://www.example.com/a', position: 0 }) === 'example.com',
  '展开来源时应显示简洁站点域名');
const todayAtNoon = new Date(2026, 8, 15, 12, 0).getTime();
const yesterdayAtNoon = new Date(2026, 8, 14, 12, 0).getTime();
const sameYear = new Date(2026, 5, 8, 9, 5).getTime();
const lastYear = new Date(2025, 11, 31, 23, 59).getTime();
check(formatAssistantDateSeparator(todayAtNoon, NOW) === '今天', '当天消息应显示今天');
check(formatAssistantDateSeparator(yesterdayAtNoon, NOW) === '昨天', '前一天消息应显示昨天');
check(/^6月8日 周./.test(formatAssistantDateSeparator(sameYear, NOW)), '同年历史消息应显示月日和星期');
check(formatAssistantDateSeparator(lastYear, NOW) === '2025年12月31日', '跨年消息应显示完整日期');
check(shouldShowAssistantDateSeparator(todayAtNoon, undefined), '列表首条应显示日期分隔');
check(!shouldShowAssistantDateSeparator(todayAtNoon, todayAtNoon - 60_000), '同一天的相邻消息不应重复显示日期');
check(shouldShowAssistantDateSeparator(todayAtNoon, yesterdayAtNoon), '跨天时应显示日期分隔');
check(/^[0-2]\d:[0-5]\d$/.test(formatAssistantMessageTime(todayAtNoon)), '气泡内只保留时分');
const cancelled = { ...message('cancelled', 25), status: 'failed' as const, errorCode: 'cancelled' };
check(!canRetryAssistantMessage(cancelled, [cancelled], 'configured'), '用户主动停止后不应显示重试');
check(assistantFailureLabel(cancelled, false) === '已停止', '主动停止应显示独立状态而不是失败');
check(canLoadOlderAssistantMessages('idle', false), '空闲时允许自动加载更早记录');
check(!canLoadOlderAssistantMessages('error', false), '分页失败后必须停止自动重试');
check(canLoadOlderAssistantMessages('error', true), '用户点击重试后允许再次分页');
check(!canLoadOlderAssistantMessages('loading', true), '分页进行中必须阻止重复请求');
check(shouldFollowAssistantEnd({ contentHeight: 1200, viewportHeight: 600, offsetY: 580 }),
  '真正贴近末端时应跟随流式增长');
check(!shouldFollowAssistantEnd({ contentHeight: 1200, viewportHeight: 600, offsetY: 300 }),
  '用户上滑阅读历史时不得强制拉回末端');
check(shouldFollowAssistantEnd({ contentHeight: 400, viewportHeight: 600, offsetY: 0 }),
  '内容不足一屏时应视为位于末端');
check(assistantBottomOffset({ contentHeight: 1200, viewportHeight: 600 }) === 600,
  '长历史必须按内容高度与新视口高度计算唯一置底位置');
check(assistantBottomOffset({ contentHeight: 400, viewportHeight: 600 }) === 0,
  '内容不足一屏时置底位置必须保持为零');
check(assistantBottomOffset({ contentHeight: -20, viewportHeight: 0 }) === 0,
  '布局过渡中的异常负尺寸不得产生负滚动位置');
check(assistantComposerElevation({ contentHeight: 400, viewportHeight: 600, offsetY: 0 }) === 0,
  '内容不足一屏时输入框不得凭空产生悬浮阴影');
check(assistantComposerElevation({ contentHeight: 1200, viewportHeight: 600, offsetY: 600 }) === 0,
  '停在最新消息时输入框应保持干净');
const partialComposerElevation = assistantComposerElevation({ contentHeight: 1200, viewportHeight: 600, offsetY: 540 });
check(partialComposerElevation > 0 && partialComposerElevation < 1,
  '下拉离开最新位置时阴影应连续渐变而不是突然出现');
check(assistantComposerElevation({ contentHeight: 1200, viewportHeight: 600, offsetY: 420 }) === 1,
  '深入阅读历史消息时输入框应显示完整悬浮层次');
const nearBottomPresentation = assistantScrollPresentation({
  contentHeight: 1200, viewportHeight: 600, offsetY: 560,
});
check(!nearBottomPresentation.atBottom && !nearBottomPresentation.showJumpToLatest
  && nearBottomPresentation.elevation > 0,
  '刚离开末端时应先连续增强渐隐，避免置底按钮突然跳出');
const historyPresentation = assistantScrollPresentation({
  contentHeight: 1200, viewportHeight: 600, offsetY: 500,
});
check(!historyPresentation.atBottom && historyPresentation.showJumpToLatest
  && historyPresentation.elevation > nearBottomPresentation.elevation,
  '深入历史后应显示置底按钮，并继续增强输入区阴影');
const bottomPresentation = assistantScrollPresentation({
  contentHeight: 1200, viewportHeight: 600, offsetY: 600,
});
check(bottomPresentation.atBottom && !bottomPresentation.showJumpToLatest
  && bottomPresentation.elevation === 0,
  '回到末端后置底按钮和额外阴影必须一起消失');
check(assistantMessageSurface('user') === 'user-bubble', '用户消息应使用品牌色气泡');
check(assistantMessageSurface('assistant') === 'assistant-bubble', '小知最终回复与处理结果应共用回复气泡');

const firstTodoIntent = assistantTodoNavigationIntent('all', 'todo-long', '');
check(firstTodoIntent?.isNew && firstTodoIntent.view === 'all', '新的全部待办跳链应被首次消费');
const repeatedTodoIntent = assistantTodoNavigationIntent('all', 'todo-long', firstTodoIntent.key);
check(repeatedTodoIntent?.isNew === false, '相同跳链重渲染时不得再次覆盖用户选择');
const nextTodoIntent = assistantTodoNavigationIntent('week', 'todo-week', firstTodoIntent.key);
check(nextTodoIntent?.isNew && nextTodoIntent.view === 'week', '新的小知回执仍应切换并定位正确列表');
check(assistantTodoNavigationIntent('other', 'todo-1', '') === null, '无效待办视图参数必须忽略');

check(listStateWhileRefreshing('ready') === 'ready',
  '从详情返回刷新时必须保留已渲染列表，避免页面变短导致滚动归零');
check(listStateWhileRefreshing('error') === 'loading'
  && listStateWhileRefreshing('loading') === 'loading',
  '首次加载或错误重试仍应显示加载状态');
check(shouldScrollAssistantOnFocus({ loadedOnce: false, followingEnd: false, preserveReturn: false }),
  '小知首次进入必须定位到最新消息');
check(shouldScrollAssistantOnFocus({ loadedOnce: true, followingEnd: true, preserveReturn: false }),
  '普通切回且原本在末端时应继续跟随最新消息');
check(!shouldScrollAssistantOnFocus({ loadedOnce: true, followingEnd: true, preserveReturn: true }),
  '从关联待办或事件返回时，即使离开前靠近末端也必须保留原位置');
check(shouldScrollAssistantOnFocus({ loadedOnce: true, followingEnd: false, preserveReturn: false }),
  '从首页或我的通过 Tab 进入小知时必须定位最新消息');
check(shouldScrollAssistantAfterRefresh('always', false),
  '首次进入或明确发送后应允许强制定位最新消息');
check(shouldScrollAssistantAfterRefresh('if-following', true),
  '回复落定时若仍在末端应继续显示完整结果');
check(!shouldScrollAssistantAfterRefresh('if-following', false),
  '回复完成、停止或重试不得把阅读历史的用户拉回末端');
check(!shouldScrollAssistantAfterRefresh('never', true),
  '普通静默刷新不得改变当前位置');
check(shouldMaintainAssistantEndAfterLayout({ previousSize: 600, nextSize: 320, followingEnd: true }),
  '键盘缩短消息区域时，位于末端的用户应继续看到最新内容');
check(shouldMaintainAssistantEndAfterLayout({ previousSize: 68, nextSize: 112, followingEnd: true }),
  '输入框变为多行时，位于末端的用户应继续看到最新内容');
check(!shouldMaintainAssistantEndAfterLayout({ previousSize: 600, nextSize: 320, followingEnd: false }),
  '键盘或输入框布局变化不得抢走历史阅读位置');
check(!shouldMaintainAssistantEndAfterLayout({ previousSize: null, nextSize: 600, followingEnd: true }),
  '首次测量布局由初始加载负责定位，不应重复触发滚动');

function operation(overrides: Partial<AssistantOperation> = {}): AssistantOperation {
  return {
    id: 'operation-1', requestId: 'request-1', operationKey: 'one',
    operationType: 'create_todo', objectType: 'todo', objectId: 'todo-1',
    beforeSnapshot: null, afterSnapshot: JSON.stringify({ dueAt: NOW + DAY }), receiptSummary: '建立待办：整理照片',
    status: 'committed', sequence: 0, createdAt: 1, undoneAt: null,
    ...overrides,
  };
}

check(assistantReceiptState([]).visible === false, '零操作不应显示空回执');
const combinedReceipt = assistantReceiptState([
  operation(),
  operation({
    id: 'operation-2', operationKey: 'event', operationType: 'create_event',
    objectType: 'event', objectId: 'event-1', receiptSummary: '建立事件：照片整理', sequence: 1,
  }),
]);
check(combinedReceipt.visible && combinedReceipt.canUndo, '多个操作应合成一张可撤销回执');
check(combinedReceipt.operations.map(item => item.sequence).join(',') === '0,1', '回执按操作顺序稳定展示');
check(assistantReceiptTarget(operation(), NOW) === '/?todoView=week&focusTodoId=todo-1',
  '7 天窗口内待办回执应进入首页本周待办并定位');
check(assistantReceiptTarget(operation({
  objectId: 'todo-long', afterSnapshot: JSON.stringify({ dueAt: NOW + 8 * DAY }),
}), NOW) === '/?todoView=all&focusTodoId=todo-long',
'7 天窗口后的待办回执应进入首页全部待办并定位');
check(assistantReceiptTarget(operation({
  objectId: 'todo-undated', afterSnapshot: JSON.stringify({ dueAt: null }),
}), NOW) === null, '无日期隐藏待办没有首页列表目标');
check(assistantReceiptTarget(operation({
  operationType: 'create_event', objectType: 'event', objectId: 'event-1',
})) === '/event/event-1', '事件回执应进入事件详情');
check(assistantReceiptTarget(operation({
  operationType: 'delete_todo', objectType: 'todo', objectId: 'todo-1',
  afterSnapshot: JSON.stringify({ deleted: true, todoId: 'todo-1' }),
})) === null, '已删除待办回执不得跳向不存在的对象');
check(assistantReceiptTarget(operation({
  operationType: 'delete_event', objectType: 'event', objectId: 'event-1',
})) === null, '已删除事件回执不得跳向关闭的详情页');
check(!assistantReceiptState([operation({ status: 'undone', undoneAt: 2 })]).canUndo,
  '已撤销操作不得再次显示可用撤销');

const grouped = groupAssistantReceiptOperations([
  operation({
    id: 'event-state', operationKey: 'event-state', operationType: 'update_event',
    objectType: 'event', objectId: 'event-1', receiptSummary: '更新事件：贷款还款', sequence: 0,
  }),
  operation({
    id: 'event-progress', operationKey: 'event-progress', operationType: 'append_event_update',
    objectType: 'event_update', objectId: 'update-1', receiptSummary: '追加进展：已还30万', sequence: 1,
    afterSnapshot: JSON.stringify({ event: { id: 'event-1' } }),
  }),
  operation({ id: 'todo', operationKey: 'todo', objectId: 'todo-2', receiptSummary: '建立待办：下个月10号还款', sequence: 2 }),
  operation({
    id: 'relation', operationKey: 'relation', operationType: 'link_todo_event',
    objectType: 'relation', objectId: 'relation-1', receiptSummary: '关联待办：还款 → 贷款还款', sequence: 3,
    afterSnapshot: JSON.stringify({ toType: 'event', toId: 'event-1' }),
  }),
]);
check(grouped.length === 2, '事件、进展、待办和内部关联应压缩成两个对象组');
check(grouped[0].summaries.length === 2, '同一事件的状态和进展应在同一紧凑组内展示');

console.log('assistant UI state tests passed');
