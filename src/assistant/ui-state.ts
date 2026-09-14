import type {
  AssistantEngineStatus,
  AssistantInitialLoadStatus,
  AssistantMessage,
  AssistantOlderLoadStatus,
} from './types';

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
  return initialLoad !== 'ready'
    || messages.some(item => item.role === 'user' && item.status === 'sending');
}

export function canLoadOlderAssistantMessages(
  status: AssistantOlderLoadStatus,
  force: boolean,
): boolean {
  if (status === 'loading') return false;
  return status === 'idle' || (status === 'error' && force);
}
