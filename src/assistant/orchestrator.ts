import { getSettings, listByKeyword, listEntries } from '../db';
import type { Settings } from '../types';
import { buildAssistantContext, type AssistantLaunchContext } from './context';
import { loadAssistantActionContext } from './action-context';
import { completeAssistantTurnWithActions, listCommittedOperationsByRequest } from './action-store';
import { prepareAssistantActions } from './event-delta';
import { requestAssistantTurn } from './provider';
import { ASSISTANT_PROMPT_VERSION } from './prompt';
import { loadAssistantMemoryContext } from './memory-retrieval';
import { validateAssistantMemoryDeltas } from './memory-validator';
import {
  beginAssistantDecisionLog,
  recordAssistantDecisionCommit,
  recordAssistantDecisionFailure,
  recordAssistantModelDecision,
  recordAssistantValidation,
} from './decision-log';
import { rankRelevantEntries, rankRelevantSegments } from './retrieval';
import {
  beginRetry,
  failTurn,
  getCurrentSegment,
  getRequestState,
  listClosedSegments,
  listMessages,
  saveUserTurn,
} from './store';
import type { AssistantMessage } from './types';
import type { AssistantOperation } from './action-types';

export interface AssistantTurnResult {
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
  operations: AssistantOperation[];
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
};

type RetryInput = {
  requestId: string;
  settings?: Settings;
  launchContext?: AssistantLaunchContext | null;
  onReplyText?: (text: string) => void;
};

const runtime = globalThis as typeof globalThis & {
  __assistantTurnJobs?: Map<string, Promise<AssistantTurnResult>>;
};
const jobs = runtime.__assistantTurnJobs ??= new Map();

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
    const unique = new Map([...fts, ...fallback, ...recent].map(entry => [entry.id, entry]));
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
}): Promise<AssistantTurnResult> {
  const state = await getRequestState(input.requestId);
  if (!state) throw new Error('找不到待处理的用户消息');
  if (state.status === 'succeeded' && state.assistantMessage) {
    return {
      userMessage: state.userMessage,
      assistantMessage: state.assistantMessage,
      operations: await listCommittedOperationsByRequest(input.requestId),
      contextStats: { estimatedTokens: 0, selectedSegments: 0, selectedEntries: 0, selectedMemories: 0 },
    };
  }

  const [messages, currentSegment, closedSegments, relevantEntries, settings, memoryContext] = await Promise.all([
    listMessages({ limit: 12 }),
    getCurrentSegment(),
    listClosedSegments(100),
    findRelatedEntries(state.userMessage.content),
    input.settings ? Promise.resolve(input.settings) : getSettings(),
    loadAssistantMemoryContext(state.userMessage.content),
  ]);
  const actionContext = await loadAssistantActionContext({
    query: state.userMessage.content,
    launchContext: input.launchContext,
    currentSegmentId: currentSegment?.id,
  });
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
    actionContext,
    memoryContext,
    inputBudget: 6000,
  });
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
      eventCandidateIds: actionContext.events.map(event => event.id),
      todoCandidateIds: actionContext.todos.map(todo => todo.id),
      memoryIds: context.selectedMemoryIds,
      launchContextId: input.launchContext?.id ?? null,
    },
    createdAt: state.userMessage.createdAt,
  }));

  try {
    const output = await requestAssistantTurn({
      settings,
      context,
      referenceAt: state.userMessage.createdAt,
      timeZone,
      onReplyText: input.onReplyText,
    });
    const eventDeltas = output.eventDeltas ?? [];
    const memoryDeltas = output.memoryDeltas ?? [];
    await safelyLog(() => recordAssistantModelDecision({
      requestId: input.requestId,
      operations: output.operations ?? [],
      eventDeltas,
      memoryDeltas,
      metadata: output.providerMetadata,
    }));
    const recentEvidence = messages
      .filter(message => message.role === 'user' && message.id !== state.userMessage.id)
      .slice(-6)
      .map(message => message.content);
    const validation = prepareAssistantActions({
      operations: output.operations ?? [],
      eventDeltas,
      actionContext,
      currentMessage: state.userMessage.content,
      recentEvidence,
      referenceAt: state.userMessage.createdAt,
    });
    const selectedMemoryIdSet = new Set(context.selectedMemoryIds);
    const memoryValidation = await validateAssistantMemoryDeltas({
      deltas: memoryDeltas,
      context: {
        active: memoryContext.active.filter(memory => selectedMemoryIdSet.has(memory.id)),
        candidates: memoryContext.candidates.filter(memory => selectedMemoryIdSet.has(memory.id)),
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
    const replyForCommit = output.providerMetadata?.protocolWarnings.includes('reply_execution_claim')
      && validation.accepted.length === 0
      && memoryValidation.accepted.length === 0
      ? '我理解了，但这次没有形成可保存的操作。请再告诉我一次要记录什么。'
      : output.reply;
    const completed = await completeAssistantTurnWithActions({
      requestId: input.requestId,
      userMessageId: state.userMessage.id,
      userSource: state.userMessage.source,
      reply: replyForCommit,
      segment: output.segment,
      operations: validation.accepted,
      memoryDeltas: memoryValidation.accepted,
      actionContext,
    });
    await safelyLog(() => recordAssistantDecisionCommit({
      requestId: input.requestId,
      operations: completed.operations,
    }));
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
      assistantMessage: completed.assistantMessage,
      operations: completed.operations,
      contextStats: {
        estimatedTokens: context.estimatedTokens,
        selectedSegments: context.selectedSegmentIds.length,
        selectedEntries: context.selectedEntryIds.length,
        selectedMemories: context.selectedMemoryIds.length,
      },
    };
  } catch (error: any) {
    const errorCode = typeof error?.code === 'string' ? error.code : 'unknown';
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
    await failTurn(input.requestId, errorCode).catch(() => {});
    throw error;
  }
}

export function sendAssistantTurn(input: SendInput): Promise<AssistantTurnResult> {
  const existing = jobs.get(input.requestId);
  if (existing) return existing;
  const job = (async () => {
    await saveUserTurn({
      requestId: input.requestId,
      content: input.content,
      source: input.source,
      createdAt: input.createdAt,
    });
    return runSavedTurn(input);
  })().finally(() => jobs.delete(input.requestId));
  jobs.set(input.requestId, job);
  return job;
}

export function retryAssistantTurn(input: RetryInput): Promise<AssistantTurnResult> {
  const existing = jobs.get(input.requestId);
  if (existing) return existing;
  const job = (async () => {
    const state = await getRequestState(input.requestId);
    if (!state) throw new Error('找不到可重试的消息');
    if (state.status !== 'succeeded') await beginRetry(input.requestId);
    return runSavedTurn(input);
  })().finally(() => jobs.delete(input.requestId));
  jobs.set(input.requestId, job);
  return job;
}
