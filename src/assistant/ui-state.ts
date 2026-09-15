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

export function shouldFollowAssistantEnd(
  metrics: AssistantScrollMetrics,
  threshold = 96,
): boolean {
  const distance = metrics.contentHeight - metrics.viewportHeight - metrics.offsetY;
  return distance <= threshold;
}

/** 合并刷新页和历史页；以 id 去重，以更新时间较新的状态覆盖旧状态。 */
export function mergeAssistantMessages(
  current: AssistantMessage[],
  incoming: AssistantMessage[],
): AssistantMessage[] {
  const byId = new Map<string, AssistantMessage>();
  for (const item of [...current, ...incoming]) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) byId.set(item.id, item);
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
  const latestUser = [...messages].reverse().find(item => item.role === 'user');
  if (latestUser?.id !== message.id) return false;
  if (message.errorCode === 'missing-key') return engineStatus === 'configured';
  return true;
}

export function assistantFailureLabel(message: AssistantMessage, canRetry: boolean): string {
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
  messages: AssistantMessage[],
): boolean {
  return initialLoad !== 'ready' || hasPendingAssistantReply(messages);
}

export function hasPendingAssistantReply(messages: AssistantMessage[]): boolean {
  return messages.some(item => item.role === 'user' && item.status === 'sending');
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
  const sorted = [...operations].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  return {
    visible: sorted.length > 0,
    canUndo: sorted.length > 0 && sorted.some(operation => operation.status === 'committed'),
    operations: sorted,
    groups: groupAssistantReceiptOperations(sorted),
  };
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
  if (operation.objectType === 'todo') {
    const after = snapshot(operation.afterSnapshot);
    const dueAt = typeof after?.dueAt === 'number' ? after.dueAt : null;
    const view = todoViewForDueAt(dueAt, now);
    if (!view) return dueAt === null ? null : '/';
    return `/?todoView=${view}&focusTodoId=${encodeURIComponent(operation.objectId)}`;
  }
  if (operation.objectType === 'event') return `/event/${encodeURIComponent(operation.objectId)}`;
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
