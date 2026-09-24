import type {
  AssistantEngineStatus,
  AssistantInitialLoadStatus,
  AssistantMessage,
  AssistantOlderLoadStatus,
} from './types';
import type { AssistantOperation } from './action-types';
import { todoViewForDueAt } from '../engine/schedule';

export interface AssistantScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}

export interface AssistantScrollPresentation {
  atBottom: boolean;
  showJumpToLatest: boolean;
  elevation: number;
}

export type AssistantRefreshScrollMode = 'always' | 'if-following' | 'never';

export interface AssistantTodoNavigationIntent {
  view: 'week' | 'all';
  focusTodoId: string | null;
  key: string;
  isNew: boolean;
}

export type AssistantListLoadState = 'loading' | 'ready' | 'error';

/**
 * A focused screen refresh must keep already-rendered content mounted. Replacing
 * a ready list with a spinner temporarily shortens its ScrollView and forces the
 * native scroll offset back to the top before navigation returns control.
 */
export function listStateWhileRefreshing(
  current: AssistantListLoadState,
): AssistantListLoadState {
  return current === 'ready' ? 'ready' : 'loading';
}

/** 跳链只负责一次性进入定位；相同参数不得在重渲染时覆盖用户的手动 Tab 选择。 */
export function assistantTodoNavigationIntent(
  todoView: string | undefined,
  focusTodoId: string | undefined,
  consumedKey: string,
): AssistantTodoNavigationIntent | null {
  const view = todoView === 'week' || todoView === 'all' ? todoView : null;
  if (!view) return null;
  const normalizedFocusTodoId = typeof focusTodoId === 'string' && focusTodoId.length > 0
    ? focusTodoId
    : null;
  const key = `${view}:${normalizedFocusTodoId ?? ''}`;
  return {
    view,
    focusTodoId: normalizedFocusTodoId,
    key,
    isNew: key !== consumedKey,
  };
}

export function shouldFollowAssistantEnd(
  metrics: AssistantScrollMetrics,
  threshold = 32,
): boolean {
  const distance = metrics.contentHeight - metrics.viewportHeight - metrics.offsetY;
  return distance <= threshold;
}

/**
 * Codex 式底部呈现：真正贴近末端才继续跟随；离开末端后先连续增强渐隐，
 * 再显示独立的置底入口。三种视觉都由同一个距离计算，避免彼此失配。
 */
export function assistantScrollPresentation(
  metrics: AssistantScrollMetrics,
  options: { bottomThreshold?: number; jumpThreshold?: number; fadeDistance?: number } = {},
): AssistantScrollPresentation {
  if (metrics.contentHeight <= metrics.viewportHeight) {
    return { atBottom: true, showJumpToLatest: false, elevation: 0 };
  }
  const distance = Math.max(0, metrics.contentHeight - metrics.viewportHeight - metrics.offsetY);
  const bottomThreshold = options.bottomThreshold ?? 32;
  const jumpThreshold = options.jumpThreshold ?? 72;
  const fadeDistance = options.fadeDistance ?? 160;
  return {
    atBottom: distance <= bottomThreshold,
    showJumpToLatest: distance > jumpThreshold,
    elevation: Math.min(1, distance / fadeDistance),
  };
}

/** 历史消息越深入输入框下方，悬浮阴影越清晰；回到最新位置时自然消失。 */
export function assistantComposerElevation(
  metrics: AssistantScrollMetrics,
  fadeDistance = 160,
): number {
  return assistantScrollPresentation(metrics, { fadeDistance }).elevation;
}

export function assistantMessageSurface(
  role: AssistantMessage['role'],
): 'user-bubble' | 'assistant-bubble' {
  return role === 'user' ? 'user-bubble' : 'assistant-bubble';
}

export function shouldScrollAssistantOnFocus(input: {
  loadedOnce: boolean;
  followingEnd: boolean;
  preserveReturn: boolean;
}): boolean {
  if (!input.loadedOnce) return true;
  if (input.preserveReturn) return false;
  return true;
}

/** 刷新落库消息时只按调用方意图贴底，不能覆盖用户刚刚发生的主动上翻。 */
export function shouldScrollAssistantAfterRefresh(
  mode: AssistantRefreshScrollMode,
  followingEnd: boolean,
): boolean {
  if (mode === 'always') return true;
  if (mode === 'if-following') return followingEnd;
  return false;
}

/** 键盘、上下文区或输入框改变可视尺寸时，仅末端跟随状态需要重新对齐。 */
export function shouldMaintainAssistantEndAfterLayout(input: {
  previousSize: number | null;
  nextSize: number;
  followingEnd: boolean;
}): boolean {
  return input.followingEnd
    && input.previousSize !== null
    && Math.abs(input.nextSize - input.previousSize) >= 1;
}

/** 合并刷新页和历史页；以 id 去重，以更新时间较新的状态覆盖旧状态。 */
export function mergeAssistantMessages(
  current: AssistantMessage[],
  incoming: AssistantMessage[],
): AssistantMessage[] {
  const byId = new Map<string, AssistantMessage>();
  for (const item of [...current, ...incoming]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    if (item.updatedAt >= existing.updatedAt) {
      byId.set(item.id, {
        ...item,
        runtimeStage: item.runtimeStage ?? existing.runtimeStage,
        runtimeStartedAt: item.runtimeStartedAt ?? existing.runtimeStartedAt,
        reasoningAvailable: item.reasoningAvailable || existing.reasoningAvailable,
        reasoningContent: item.reasoningContent ?? existing.reasoningContent,
        reasoningStartedAt: item.reasoningStartedAt ?? existing.reasoningStartedAt,
        reasoningCompletedAt: item.reasoningCompletedAt ?? existing.reasoningCompletedAt,
      });
    }
  }
  return [...byId.values()].sort((left, right) => (
    left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  ));
}

export function canRetryAssistantMessage(
  message: AssistantMessage,
  messages: AssistantMessage[],
  engineStatus: AssistantEngineStatus,
): boolean {
  if (message.role !== 'user' || message.status !== 'failed') return false;
  if (message.errorCode === 'cancelled') return false;
  const latestUser = [...messages].reverse().find(item => item.role === 'user');
  if (latestUser?.id !== message.id) return false;
  if (message.errorCode === 'missing-key') return engineStatus === 'configured';
  return true;
}

export function assistantFailureLabel(message: AssistantMessage, canRetry: boolean): string {
  if (message.errorCode === 'cancelled') return '已停止';
  if (!canRetry) return message.errorCode === 'missing-key' ? '尚未回复' : '这条未回复';
  if (message.errorCode === 'interrupted') return '上次回复被中断 · 重试';
  if (message.errorCode === 'provider' || message.errorCode === 'invalid-response') {
    return '回复出了点问题 · 重试';
  }
  if (message.errorCode === 'missing-key') return '尚未回复 · 重试';
  return '小知暂时没回复 · 重试';
}

export function isAssistantComposerDisabled(
  initialLoad: AssistantInitialLoadStatus,
  _messages: AssistantMessage[],
): boolean {
  return initialLoad !== 'ready';
}

export function hasPendingAssistantReply(messages: AssistantMessage[]): boolean {
  return messages.some(item => item.role === 'user' && item.status === 'sending');
}

export function pendingAssistantRequestId(messages: AssistantMessage[]): string | null {
  const pending = [...messages].reverse().find(item => item.role === 'user' && item.status === 'sending');
  return pending?.requestId ?? null;
}

export function canLoadOlderAssistantMessages(
  status: AssistantOlderLoadStatus,
  force: boolean,
): boolean {
  if (status === 'loading') return false;
  return status === 'idle' || (status === 'error' && force);
}

export function assistantReceiptState(operations: AssistantOperation[]): {
  visible: boolean;
  canUndo: boolean;
  operations: AssistantOperation[];
  groups: AssistantReceiptGroup[];
} {
  const sorted = operations
    .filter(operation => !isHiddenMemoryCandidateOperation(operation))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  return {
    visible: sorted.length > 0,
    canUndo: sorted.length > 0 && sorted.some(operation => operation.status === 'committed'),
    operations: sorted,
    groups: groupAssistantReceiptOperations(sorted),
  };
}

function isHiddenMemoryCandidateOperation(operation: AssistantOperation): boolean {
  if (operation.objectType !== 'memory' || operation.operationType !== 'create_memory') return false;
  const after = snapshot(operation.afterSnapshot);
  return after?.status === 'candidate';
}

export interface AssistantReceiptGroup {
  key: string;
  target: string | null;
  primaryOperation: AssistantOperation;
  summaries: string[];
  undone: boolean;
}

export function groupAssistantReceiptOperations(operations: AssistantOperation[]): AssistantReceiptGroup[] {
  const sorted = [...operations].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const substantive = sorted.filter(operation => operation.objectType !== 'relation');
  const visible = substantive.length ? substantive : sorted;
  const groups = new Map<string, AssistantReceiptGroup>();
  for (const operation of visible) {
    const target = assistantReceiptTarget(operation);
    const key = target ?? `${operation.objectType}:${operation.objectId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        target,
        primaryOperation: operation,
        summaries: [operation.receiptSummary],
        undone: operation.status === 'undone',
      });
      continue;
    }
    if (!existing.summaries.includes(operation.receiptSummary)) existing.summaries.push(operation.receiptSummary);
    existing.undone = existing.undone && operation.status === 'undone';
  }
  return [...groups.values()];
}

function snapshot(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function assistantReceiptTarget(operation: AssistantOperation, now = Date.now()): string | null {
  if (operation.operationType === 'delete_todo' || operation.operationType === 'delete_event') return null;
  if (operation.objectType === 'todo') {
    const after = snapshot(operation.afterSnapshot);
    const dueAt = typeof after?.dueAt === 'number' ? after.dueAt : null;
    const view = todoViewForDueAt(dueAt, now);
    if (!view) return dueAt === null ? null : '/';
    return `/?todoView=${view}&focusTodoId=${encodeURIComponent(operation.objectId)}`;
  }
  if (operation.objectType === 'event') return `/event/${encodeURIComponent(operation.objectId)}`;
  if (operation.objectType === 'memory') return '/profile';
  const after = snapshot(operation.afterSnapshot);
  if (operation.objectType === 'event_update') {
    const eventId = after?.event?.id ?? after?.eventId ?? after?.event_id;
    return typeof eventId === 'string' ? `/event/${encodeURIComponent(eventId)}` : null;
  }
  if (operation.objectType === 'relation') {
    const eventId = after?.toType === 'event'
      ? after.toId
      : after?.fromType === 'event' ? after.fromId : null;
    return typeof eventId === 'string' ? `/event/${encodeURIComponent(eventId)}` : null;
  }
  return null;
}
