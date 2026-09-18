import type { AssistantOperation } from './action-types';

export type AssistantExecutionOutcome = 'committed' | 'rejected' | 'no_change' | 'failed';

export interface AssistantExecutionResult {
  outcome: AssistantExecutionOutcome;
  committed: Array<Pick<AssistantOperation, 'operationType' | 'objectType' | 'objectId' | 'receiptSummary'>>;
  rejected: Array<{ type: string; reason: string; detail?: string }>;
  error?: string;
}

export function buildAssistantExecutionResult(input: {
  operations: AssistantOperation[];
  rejected?: Array<{ type?: string; reason?: string; detail?: string }>;
  error?: string;
}): AssistantExecutionResult {
  const rejected = (input.rejected ?? []).map(item => ({
    type: item.type ?? 'unknown',
    reason: item.reason ?? 'unknown',
    ...(item.detail ? { detail: item.detail } : {}),
  }));
  const committed = input.operations.map(operation => ({
    operationType: operation.operationType,
    objectType: operation.objectType,
    objectId: operation.objectId,
    receiptSummary: operation.receiptSummary,
  }));
  const outcome: AssistantExecutionOutcome = input.error
    ? 'failed'
    : committed.length > 0
      ? 'committed'
      : rejected.length > 0
        ? 'rejected'
        : 'no_change';
  return { outcome, committed, rejected, ...(input.error ? { error: input.error } : {}) };
}

export function fallbackReplyForExecution(result: AssistantExecutionResult, draftReply?: string): string {
  if (result.outcome === 'committed') {
    const summaries = result.committed.map(item => item.receiptSummary).filter(Boolean);
    return summaries.length ? summaries.join('\n') : '已经按你的要求更新好了。';
  }
  if (result.outcome === 'rejected') return '我理解了你的意思，但这次更新没有通过数据校验，所以没有改动原记录。';
  if (result.outcome === 'failed') return '我理解了你的意思，但保存时出了问题，这次没有完成更新。';
  return draftReply?.trim() || '明白了，这次没有需要改动的事件或待办。';
}
