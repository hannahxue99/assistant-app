import { getSettings, listByKeyword, listEntries } from '../db';
import type { Settings } from '../types';
import { buildAssistantContext, type AssistantLaunchContext } from './context';
import { requestAssistantTurn } from './provider';
import { rankRelevantEntries, rankRelevantSegments } from './retrieval';
import {
  beginRetry,
  completeTurn,
  failTurn,
  getCurrentSegment,
  getRequestState,
  listClosedSegments,
  listMessages,
  saveUserTurn,
} from './store';
import type { AssistantMessage } from './types';

export interface AssistantTurnResult {
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
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
};

type RetryInput = {
  requestId: string;
  settings?: Settings;
  launchContext?: AssistantLaunchContext | null;
};

const runtime = globalThis as typeof globalThis & {
  __assistantTurnJobs?: Map<string, Promise<AssistantTurnResult>>;
};
const jobs = runtime.__assistantTurnJobs ??= new Map();

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
}): Promise<AssistantTurnResult> {
  const state = await getRequestState(input.requestId);
  if (!state) throw new Error('找不到待处理的用户消息');
  if (state.status === 'succeeded' && state.assistantMessage) {
    return {
      userMessage: state.userMessage,
      assistantMessage: state.assistantMessage,
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
    inputBudget: 6000,
  });
  console.log('[assistant-context]', {
    estimatedTokens: context.estimatedTokens,
    recentMessages: context.recentMessages.length,
    selectedSegments: context.selectedSegmentIds.length,
    selectedEntries: context.selectedEntryIds.length,
    trimmed: context.stats,
  });

  try {
    const output = await requestAssistantTurn({
      settings,
      context,
      referenceAt: state.userMessage.createdAt,
    });
    const assistantMessage = await completeTurn({
      requestId: input.requestId,
      reply: output.reply,
      segment: output.segment,
    });
    return {
      userMessage: (await getRequestState(input.requestId))?.userMessage ?? state.userMessage,
      assistantMessage,
      contextStats: {
        estimatedTokens: context.estimatedTokens,
        selectedSegments: context.selectedSegmentIds.length,
        selectedEntries: context.selectedEntryIds.length,
      },
    };
  } catch (error: any) {
    await failTurn(input.requestId, typeof error?.code === 'string' ? error.code : 'unknown').catch(() => {});
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
