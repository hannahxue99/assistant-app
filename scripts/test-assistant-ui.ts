import {
  assistantFailureLabel,
  canLoadOlderAssistantMessages,
  canRetryAssistantMessage,
  hasPendingAssistantReply,
  isAssistantComposerDisabled,
  mergeAssistantMessages,
  assistantReceiptState,
  assistantReceiptTarget,
} from '../src/assistant/ui-state';
import { ASSISTANT_EMPTY_DESCRIPTION } from '../src/assistant/ui-copy';
import type { AssistantMessage } from '../src/assistant/types';
import type { AssistantOperation } from '../src/assistant/action-types';

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
check(!hasPendingAssistantReply([latestFailure]), '失败消息不应继续标记为等待回复');
check(isAssistantComposerDisabled('loading', []), '首次加载期间输入应禁用');
check(isAssistantComposerDisabled('error', []), '首次加载失败时输入应禁用');
check(isAssistantComposerDisabled('ready', [sending]), '有回复处理中时输入应禁用');
check(!isAssistantComposerDisabled('ready', [latestFailure]), '回复失败后输入应恢复');
check(canLoadOlderAssistantMessages('idle', false), '空闲时允许自动加载更早记录');
check(!canLoadOlderAssistantMessages('error', false), '分页失败后必须停止自动重试');
check(canLoadOlderAssistantMessages('error', true), '用户点击重试后允许再次分页');
check(!canLoadOlderAssistantMessages('loading', true), '分页进行中必须阻止重复请求');

function operation(overrides: Partial<AssistantOperation> = {}): AssistantOperation {
  return {
    id: 'operation-1', requestId: 'request-1', operationKey: 'one',
    operationType: 'create_todo', objectType: 'todo', objectId: 'todo-1',
    beforeSnapshot: null, afterSnapshot: '{}', receiptSummary: '建立待办：整理照片',
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
check(assistantReceiptTarget(operation()) === '/entry/todo-1', '待办回执应进入待办详情');
check(assistantReceiptTarget(operation({
  operationType: 'create_event', objectType: 'event', objectId: 'event-1',
})) === '/event/event-1', '事件回执应进入事件详情');
check(!assistantReceiptState([operation({ status: 'undone', undoneAt: 2 })]).canUndo,
  '已撤销操作不得再次显示可用撤销');

console.log('assistant UI state tests passed');
