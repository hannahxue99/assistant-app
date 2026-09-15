import { getSettings, listByKeyword, listEntries } from '../db';
import type { Settings } from '../types';
import { buildAssistantContext, type AssistantLaunchContext } from './context';
import { loadAssistantActionContext } from './action-context';
import { completeAssistantTurnWithActions, listCommittedOperationsByRequest } from './action-store';
import { validateAssistantActions } from './action-validator';
import { requestAssistantTurn } from './provider';
import { ASSISTANT_PROMPT_VERSION } from './prompt';
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
      contextStats: { estimatedTokens: 0, selectedSegments: 0, selectedEntries: 0 },
    };
  }

  const [messages, currentSegment, closedSegments, relevantEntries, settings] = await Promise.all([
    listMessages({ limit: 12 }),
    getCurrentSegment(),
    listClosedSegments(100),
    findRelatedEntries(state.userMessage.content),
    input.settings ? Promise.resolve(input.settings) : getSettings(),
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
    inputBudget: 6000,
  });
  console.log('[assistant-context]', {
    estimatedTokens: context.estimatedTokens,
    recentMessages: context.recentMessages.length,
    selectedSegments: context.selectedSegmentIds.length,
    selectedEntries: context.selectedEntryIds.length,
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
    await safelyLog(() => recordAssistantModelDecision({
      requestId: input.requestId,
      operations: output.operations ?? [],
      metadata: output.providerMetadata,
    }));
    const validation = validateAssistantActions({
      operations: output.operations ?? [],
      actionContext,
      currentMessage: state.userMessage.content,
      recentEvidence: messages
        .filter(message => message.role === 'user' && message.id !== state.userMessage.id)
        .slice(-6)
        .map(message => message.content),
      referenceAt: state.userMessage.createdAt,
    });
    await safelyLog(() => recordAssistantValidation({
      requestId: input.requestId,
      accepted: validation.accepted,
      rejected: validation.rejected,
    }));
    const completed = await completeAssistantTurnWithActions({
      requestId: input.requestId,
      userMessageId: state.userMessage.id,
      userSource: state.userMessage.source,
      reply: output.reply,
      segment: output.segment,
      operations: validation.accepted,
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
        rejected: validation.rejected.map(item => `${item.type}:${item.reason}`),
        committed: completed.operations.map(operation => operation.operationType),
        modelMs: output.providerMetadata
          ? output.providerMetadata.completedAt - output.providerMetadata.startedAt
          : null,
        tokens: output.providerMetadata?.totalTokens ?? null,
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
      },
    };
  } catch (error: any) {
    const errorCode = typeof error?.code === 'string' ? error.code : 'unknown';
    await safelyLog(() => recordAssistantDecisionFailure(input.requestId, errorCode));
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
