import { getSettings, listByKeyword, listEntries } from '../db';
import type { Settings } from '../types';
import { buildAssistantContext, type AssistantLaunchContext } from './context';
import { loadAssistantActionContext } from './action-context';
import { completeAssistantTurnWithActions, listCommittedOperationsByRequest } from './action-store';
import { prepareAssistantActions } from './event-delta';
import {
  requestAssistantFinalReply,
  requestAssistantTurn,
  type AssistantProviderProgressStage,
} from './provider';
import {
  executeAssistantReadTool,
  mergeAssistantReadSets,
  type AssistantReadToolExecution,
} from './data-tools';
import { buildAssistantExecutionResult, fallbackReplyForExecution } from './execution-result';
import type { AssistantRuntimeStage } from './runtime-state';
import { getAssistantReasoning, type AssistantReasoning } from './reasoning-store';
import { ASSISTANT_PROMPT_VERSION } from './prompt';
import { loadAssistantMemoryContext } from './memory-retrieval';
import { listMemoriesByIds } from './memory-store';
import { validateAssistantMemoryDeltas } from './memory-validator';
import {
  beginAssistantDecisionLog,
  recordAssistantDecisionCommit,
  recordAssistantDecisionFailure,
  recordAssistantExecutionOutcome,
  recordAssistantModelDecision,
  recordAssistantValidation,
} from './decision-log';
import { rankRelevantEntries, rankRelevantSegments } from './retrieval';
import {
  beginRetry,
  cancelTurn,
  failTurn,
  getCurrentSegment,
  getRequestState,
  listClosedSegments,
  listMessages,
  saveUserTurn,
  updateAssistantReply,
} from './store';
import type { AssistantMessage } from './types';
import type { AssistantOperation } from './action-types';
import {
  loadValidAssistantWorkingSnapshots,
  readSetFromAssistantWorkingSnapshots,
  rememberAssistantWorkingSnapshots,
} from './working-snapshots';

export interface AssistantTurnResult {
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
  operations: AssistantOperation[];
  reasoning: AssistantReasoning | null;
  contextStats: {
    estimatedTokens: number;
    selectedSegments: number;
    selectedEntries: number;
    selectedMemories: number;
  };
}

type SendInput = {
  requestId: string;
  content: string;
  source: 'text' | 'voice' | 'contextual';
  settings?: Settings;
  createdAt?: number;
  launchContext?: AssistantLaunchContext | null;
  onReplyText?: (text: string) => void;
  onReasoningText?: (text: string) => void;
  onProgress?: (stage: AssistantRuntimeStage) => void;
};

type RetryInput = {
  requestId: string;
  settings?: Settings;
  launchContext?: AssistantLaunchContext | null;
  onReplyText?: (text: string) => void;
  onReasoningText?: (text: string) => void;
  onProgress?: (stage: AssistantRuntimeStage) => void;
};

type AssistantTurnJob = {
  promise: Promise<AssistantTurnResult>;
  controller: AbortController;
  partialReply: string;
};

const runtime = globalThis as typeof globalThis & {
  __assistantTurnJobsV2?: Map<string, AssistantTurnJob>;
};
const jobs = runtime.__assistantTurnJobsV2 ??= new Map();

function cancellationError(): Error & { code: string } {
  return Object.assign(new Error('请求已取消'), { code: 'cancelled' });
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError();
}

async function safelyLog(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn('[assistant-decision] 日志写入失败', error);
  }
}

async function findRelatedEntries(query: string) {
  const keyword = query.trim().slice(0, 80);
  if (!keyword) return [];
  try {
    const [fts, fallback, recent] = await Promise.all([
      listEntries({ query: keyword, kind: 'all', showDone: true }, 20).catch(() => []),
      listByKeyword(keyword, 20).catch(() => []),
      listEntries({ query: '', kind: 'all', showDone: true }, 500),
    ]);
    const unique = new Map([...fts, ...fallback, ...recent]
      .filter(entry => entry.kind !== 'task')
      .map(entry => [entry.id, entry]));
    return rankRelevantEntries(keyword, [...unique.values()]);
  } catch {
    return [];
  }
}

async function runSavedTurn(input: {
  requestId: string;
  settings?: Settings;
  launchContext?: AssistantLaunchContext | null;
  onReplyText?: (text: string) => void;
  onReasoningText?: (text: string) => void;
  onProgress?: (stage: AssistantRuntimeStage) => void;
  signal?: AbortSignal;
  getPartialReply?: () => string;
}): Promise<AssistantTurnResult> {
  if (input.signal?.aborted) {
    await cancelTurn(input.requestId, input.getPartialReply?.() ?? null).catch(() => {});
    throw cancellationError();
  }
  const state = await getRequestState(input.requestId);
  if (!state) throw new Error('找不到待处理的用户消息');
  if (state.status === 'succeeded' && state.assistantMessage) {
    return {
      userMessage: state.userMessage,
      assistantMessage: state.assistantMessage,
      operations: await listCommittedOperationsByRequest(input.requestId),
      reasoning: await getAssistantReasoning(input.requestId),
      contextStats: { estimatedTokens: 0, selectedSegments: 0, selectedEntries: 0, selectedMemories: 0 },
    };
  }

  const currentSegment = await getCurrentSegment();
  const [messages, closedSegments, relevantEntries, settings, memoryContext, validWorkingSnapshots] = await Promise.all([
    listMessages({ limit: 12 }),
    listClosedSegments(100),
    findRelatedEntries(state.userMessage.content),
    input.settings ? Promise.resolve(input.settings) : getSettings(),
    loadAssistantMemoryContext(state.userMessage.content),
    loadValidAssistantWorkingSnapshots(currentSegment?.id),
  ]);
  const recentLegacyIds = new Set(messages.map(item => item.legacyEntryId).filter(Boolean));
  const context = buildAssistantContext({
    recentMessages: messages.map(item => ({
      id: item.id,
      role: item.role,
      content: item.content,
      createdAt: item.createdAt,
    })),
    currentSegmentSummary: currentSegment?.summary,
    retrievedSegments: rankRelevantSegments(state.userMessage.content, closedSegments),
    relevantEntries: relevantEntries.filter(item => !recentLegacyIds.has(item.id)),
    launchContext: input.launchContext,
    memoryContext,
    workingSnapshots: validWorkingSnapshots,
    inputBudget: 6000,
  });
  const selectedSnapshotIdSet = new Set(context.selectedWorkingSnapshotIds);
  const selectedWorkingSnapshots = validWorkingSnapshots.filter(snapshot => selectedSnapshotIdSet.has(snapshot.id));
  console.log('[assistant-context]', {
    estimatedTokens: context.estimatedTokens,
    recentMessages: context.recentMessages.length,
    selectedSegments: context.selectedSegmentIds.length,
    selectedEntries: context.selectedEntryIds.length,
    selectedMemories: context.selectedMemoryIds.length,
    trimmed: context.stats,
  });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  await safelyLog(() => beginAssistantDecisionLog({
    requestId: input.requestId,
    userMessageId: state.userMessage.id,
    promptVersion: ASSISTANT_PROMPT_VERSION,
    model: settings.llmModel,
    referenceAt: state.userMessage.createdAt,
    timeZone,
    contextRefs: {
      recentMessageIds: context.recentMessages.map(message => message.id),
      segmentIds: context.selectedSegmentIds,
      entryIds: context.selectedEntryIds,
      eventCandidateIds: selectedWorkingSnapshots.flatMap(snapshot => snapshot.readEventIds),
      todoCandidateIds: selectedWorkingSnapshots.flatMap(snapshot => snapshot.readTodoIds),
      memoryIds: context.selectedMemoryIds,
      launchContextId: input.launchContext?.id ?? null,
    },
    createdAt: state.userMessage.createdAt,
  }));

  try {
    throwIfCancelled(input.signal);
    const readExecutions: AssistantReadToolExecution[] = [];
    const readExecutionCache = new Map<string, Promise<AssistantReadToolExecution>>();
    const executeReadTool = async (call: {
      id: string;
      name: string;
      argumentsJson: string;
    }): Promise<AssistantReadToolExecution> => {
      const cacheKey = `${call.name}:${call.argumentsJson}`;
      let pending = readExecutionCache.get(cacheKey);
      if (!pending) {
        pending = executeAssistantReadTool(call);
        readExecutionCache.set(cacheKey, pending);
        readExecutions.push(await pending);
      }
      const execution = await pending;
      return execution.toolCallId === call.id ? execution : { ...execution, toolCallId: call.id };
    };
    const output = await requestAssistantTurn({
      settings,
      context,
      referenceAt: state.userMessage.createdAt,
      timeZone,
      signal: input.signal,
      onReasoningText: input.onReasoningText,
      onProgress: (stage: AssistantProviderProgressStage) => input.onProgress?.(
        stage === 'reading' ? 'reading' : 'planning',
      ),
      executeReadTool,
    });
    throwIfCancelled(input.signal);
    input.onProgress?.('planning');
    const cachedReadSet = readSetFromAssistantWorkingSnapshots(selectedWorkingSnapshots);
    const executedReadSet = mergeAssistantReadSets(readExecutions);
    const grounding = output.grounding ?? { eventIds: [], todoIds: [], memoryIds: [] };
    const readEventIds = [...new Set([
      ...cachedReadSet.eventIds, ...executedReadSet.eventIds, ...grounding.eventIds,
    ])];
    const readTodoIds = [...new Set([
      ...cachedReadSet.todoIds, ...executedReadSet.todoIds, ...grounding.todoIds,
    ])];
    const readMemoryIds = [...new Set([
      ...cachedReadSet.memoryIds, ...executedReadSet.memoryIds, ...grounding.memoryIds,
    ])];
    const groundedActionContext = await loadAssistantActionContext({
      query: '',
      readEventIds,
      readTodoIds,
      selectionMode: 'read-set',
    });
    const eventDeltas = output.eventDeltas ?? [];
    const memoryDeltas = output.memoryDeltas ?? [];
    await safelyLog(() => recordAssistantModelDecision({
      requestId: input.requestId,
      operations: output.operations ?? [],
      eventDeltas,
      memoryDeltas,
      metadata: output.providerMetadata,
      toolReadEventIds: readEventIds,
      toolReadTodoIds: readTodoIds,
      toolReadMemoryIds: readMemoryIds,
    }));
    const recentEvidence = messages
      .filter(message => message.role === 'user' && message.id !== state.userMessage.id)
      .slice(-6)
      .map(message => message.content);
    const validation = prepareAssistantActions({
      operations: output.operations ?? [],
      eventDeltas,
      actionContext: groundedActionContext,
      currentMessage: state.userMessage.content,
      recentEvidence,
      referenceAt: state.userMessage.createdAt,
    });
    const selectedMemoryIdSet = new Set([...context.selectedMemoryIds, ...readMemoryIds]);
    const toolReadMemories = await listMemoriesByIds(readMemoryIds);
    const memoryById = new Map([
      ...memoryContext.active,
      ...memoryContext.candidates,
      ...toolReadMemories,
    ].map(memory => [memory.id, memory]));
    const memoryValidation = await validateAssistantMemoryDeltas({
      deltas: memoryDeltas,
      context: {
        active: [...memoryById.values()]
          .filter(memory => memory.status === 'active' && selectedMemoryIdSet.has(memory.id)),
        candidates: [...memoryById.values()]
          .filter(memory => memory.status === 'candidate' && selectedMemoryIdSet.has(memory.id)),
      },
      userMessage: state.userMessage.content,
      userMessageId: state.userMessage.id,
    });
    await safelyLog(() => recordAssistantValidation({
      requestId: input.requestId,
      accepted: validation.accepted,
      rejected: validation.rejected,
      compiled: validation.compiled,
      acceptedMemoryDeltas: memoryValidation.accepted,
      rejectedMemoryDeltas: memoryValidation.rejected,
    }));
    throwIfCancelled(input.signal);
    input.onProgress?.('updating');
    const completed = await completeAssistantTurnWithActions({
      requestId: input.requestId,
      userMessageId: state.userMessage.id,
      userSource: state.userMessage.source,
      reply: '我已经收到，正在确认这次处理结果。',
      segment: output.segment,
      operations: validation.accepted,
      memoryDeltas: memoryValidation.accepted,
      reasoning: output.reasoning
        ? {
          requestId: input.requestId,
          content: output.reasoning.content,
          startedAt: output.reasoning.startedAt,
          completedAt: output.reasoning.completedAt,
          createdAt: Date.now(),
        }
        : null,
      actionContext: groundedActionContext,
    });
    const completedState = await getRequestState(input.requestId);
    rememberAssistantWorkingSnapshots(
      completedState?.userMessage.segmentId ?? currentSegment?.id ?? '',
      readExecutions,
    );
    if (completed.operations.length > 0) {
      await safelyLog(() => recordAssistantDecisionCommit({
        requestId: input.requestId,
        operations: completed.operations,
      }));
    }
    const proposedWriteCount = validation.accepted.length + memoryValidation.accepted.length;
    const executionRejected: Array<{ type: string; reason: string; detail?: string }> = [
      ...validation.rejected.map(item => ({
        type: item.type,
        reason: item.reason,
        ...('detail' in item && item.detail ? { detail: item.detail } : {}),
      })),
      ...memoryValidation.rejected.map(item => ({
        type: item.action,
        reason: item.reason,
      })),
    ];
    if (proposedWriteCount > completed.operations.length) {
      executionRejected.push({
        type: 'execution',
        reason: 'one_or_more_operations_not_committed',
        detail: `planned=${proposedWriteCount}, committed=${completed.operations.length}`,
      });
    }
    if (completed.operations.length === 0
      && output.providerMetadata?.protocolWarnings.includes('reply_execution_claim')) {
      executionRejected.push({
        type: 'reply',
        reason: 'unverified_execution_claim',
      });
    }
    const executionResult = buildAssistantExecutionResult({
      operations: completed.operations,
      rejected: executionRejected,
    });
    await safelyLog(() => recordAssistantExecutionOutcome({
      requestId: input.requestId,
      result: executionResult,
    }));
    const fallbackReply = fallbackReplyForExecution(executionResult, output.reply);
    let assistantMessage = await updateAssistantReply(input.requestId, fallbackReply);
    input.onProgress?.('answering');
    const needsGroundedNarration = completed.operations.length > 0
      || proposedWriteCount > 0
      || executionRejected.length > 0;
    if (needsGroundedNarration) {
      try {
        const finalReply = await requestAssistantFinalReply({
          settings,
          userMessage: state.userMessage.content,
          draftReply: output.reply,
          executionResult,
          signal: input.signal,
          onReplyText: input.onReplyText,
          onProgress: () => input.onProgress?.('answering'),
        });
        assistantMessage = await updateAssistantReply(input.requestId, finalReply.reply);
      } catch (narrationError) {
        console.warn('[assistant-final-reply] 使用本地真实回执文案', narrationError);
        input.onReplyText?.(fallbackReply);
      }
    } else {
      input.onReplyText?.(fallbackReply);
    }
    input.onProgress?.('finalizing');
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[assistant-decision]', {
        requestId: input.requestId,
        proposed: (output.operations ?? []).map(operation => operation.type),
        eventDeltas: eventDeltas.map(delta => delta.key),
        memoryDeltas: memoryDeltas.map(delta => `${delta.action}:${delta.key}`),
        rejected: validation.rejected.map(item => `${item.type}:${item.reason}`),
        rejectedMemories: memoryValidation.rejected.map(item => `${item.action}:${item.reason}`),
        committed: completed.operations.map(operation => operation.operationType),
        modelMs: output.providerMetadata
          ? output.providerMetadata.completedAt - output.providerMetadata.startedAt
          : null,
        tokens: output.providerMetadata?.totalTokens ?? null,
        providerAttemptCount: output.providerMetadata?.attemptCount ?? 0,
        providerAttempts: output.providerMetadata?.attempts ?? [],
        warnings: output.providerMetadata?.protocolWarnings ?? [],
      });
    }
    return {
      userMessage: (await getRequestState(input.requestId))?.userMessage ?? state.userMessage,
      assistantMessage,
      operations: completed.operations,
      reasoning: output.reasoning
        ? {
          requestId: input.requestId,
          content: output.reasoning.content,
          startedAt: output.reasoning.startedAt,
          completedAt: output.reasoning.completedAt,
          createdAt: completed.assistantMessage.createdAt,
        }
        : null,
      contextStats: {
        estimatedTokens: context.estimatedTokens,
        selectedSegments: context.selectedSegmentIds.length,
        selectedEntries: context.selectedEntryIds.length,
        selectedMemories: context.selectedMemoryIds.length,
      },
    };
  } catch (error: any) {
    const cancelled = input.signal?.aborted || error?.code === 'cancelled';
    const errorCode = cancelled ? 'cancelled' : typeof error?.code === 'string' ? error.code : 'unknown';
    const diagnostics = error?.diagnostics;
    const errorDetail = typeof error?.message === 'string' ? error.message : String(error ?? '未知错误');
    await safelyLog(() => recordAssistantDecisionFailure({
      requestId: input.requestId,
      errorCode,
      errorDetail,
      providerAttemptCount: diagnostics?.attemptCount,
      providerAttempts: diagnostics?.attempts,
      protocolWarnings: diagnostics?.protocolWarnings,
    }));
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[assistant-decision]', {
        requestId: input.requestId,
        status: 'failed',
        errorCode,
        errorDetail,
        providerAttemptCount: diagnostics?.attemptCount ?? 0,
        providerAttempts: diagnostics?.attempts ?? [],
      });
    }
    if (cancelled) {
      await cancelTurn(input.requestId, input.getPartialReply?.() ?? null).catch(() => {});
      throw cancellationError();
    }
    await failTurn(input.requestId, errorCode).catch(() => {});
    throw error;
  }
}

export function sendAssistantTurn(input: SendInput): Promise<AssistantTurnResult> {
  const existing = jobs.get(input.requestId);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const entry: AssistantTurnJob = {
    controller,
    partialReply: '',
    promise: Promise.resolve(null as unknown as AssistantTurnResult),
  };
  jobs.set(input.requestId, entry);
  entry.promise = (async () => {
    await saveUserTurn({
      requestId: input.requestId,
      content: input.content,
      source: input.source,
      createdAt: input.createdAt,
    });
    return runSavedTurn({
      ...input,
      signal: controller.signal,
      getPartialReply: () => entry.partialReply,
      onReplyText: (text) => {
        entry.partialReply = text;
        input.onReplyText?.(text);
      },
    });
  })().finally(() => {
    if (jobs.get(input.requestId) === entry) jobs.delete(input.requestId);
  });
  return entry.promise;
}

export function retryAssistantTurn(input: RetryInput): Promise<AssistantTurnResult> {
  const existing = jobs.get(input.requestId);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const entry: AssistantTurnJob = {
    controller,
    partialReply: '',
    promise: Promise.resolve(null as unknown as AssistantTurnResult),
  };
  jobs.set(input.requestId, entry);
  entry.promise = (async () => {
    const state = await getRequestState(input.requestId);
    if (!state) throw new Error('找不到可重试的消息');
    if (state.status !== 'succeeded') await beginRetry(input.requestId);
    return runSavedTurn({
      ...input,
      signal: controller.signal,
      getPartialReply: () => entry.partialReply,
      onReplyText: (text) => {
        entry.partialReply = text;
        input.onReplyText?.(text);
      },
    });
  })().finally(() => {
    if (jobs.get(input.requestId) === entry) jobs.delete(input.requestId);
  });
  return entry.promise;
}

export async function cancelAssistantTurn(requestId: string): Promise<boolean> {
  const job = jobs.get(requestId);
  if (!job) return cancelTurn(requestId, null);
  job.controller.abort();
  const cancelled = await cancelTurn(requestId, job.partialReply);
  void job.promise.catch(() => {});
  return cancelled;
}
