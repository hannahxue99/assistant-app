import { estimateAssistantTokens, truncateToAssistantTokenBudget } from './token-budget';
import type { AssistantActionContext } from './action-types';
import type { AssistantMemoryContext } from './memory-types';
import type { AssistantWorkingSnapshot } from './working-snapshots';

export { estimateAssistantTokens } from './token-budget';

export interface ContextMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface RetrievedSegment {
  id: string;
  summary: string;
  relevance: number;
  updatedAt: number;
  dedupeKey?: string;
}

export interface RelevantEntry {
  id: string;
  text: string;
  relevance: number;
  updatedAt: number;
  dedupeKey?: string;
}

export interface AssistantLaunchContext {
  kind: 'event' | 'reminder' | 'todo';
  id: string;
  label: string;
  state?: string;
}

export interface AssistantContextInput {
  recentMessages: ContextMessage[];
  currentSegmentSummary?: string | null;
  retrievedSegments?: RetrievedSegment[];
  relevantEntries?: RelevantEntry[];
  launchContext?: AssistantLaunchContext | null;
  /** 兼容旧调用；事件与待办正文不会再从这里进入模型上下文。 */
  actionContext?: AssistantActionContext;
  memoryContext?: AssistantMemoryContext;
  workingSnapshots?: AssistantWorkingSnapshot[];
  inputBudget?: number;
}

export interface AssistantContextResult {
  contextBlock: string;
  recentMessages: ContextMessage[];
  selectedSegmentIds: string[];
  selectedEntryIds: string[];
  selectedMemoryIds: string[];
  selectedWorkingSnapshotIds: string[];
  estimatedTokens: number;
  stats: {
    inputBudget: number;
    trimmedRecentMessages: number;
    trimmedSegments: number;
    trimmedEntries: number;
    trimmedMemories: number;
    trimmedWorkingSnapshots: number;
  };
}

const MAX_RECENT_MESSAGES = 12;
const MAX_RETRIEVED_SEGMENTS = 3;
const MAX_RELEVANT_ENTRIES = 5;
const DEFAULT_INPUT_BUDGET = 6000;

function rankByRelevance<T extends { relevance: number; updatedAt: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => (
    right.relevance - left.relevance || right.updatedAt - left.updatedAt
  ));
}

function renderContextBlock(input: {
  launchContext?: AssistantLaunchContext | null;
  currentSummary: string;
  segments: RetrievedSegment[];
  entries: RelevantEntry[];
  memoryContext?: AssistantMemoryContext;
  workingSnapshots: AssistantWorkingSnapshot[];
}): string {
  const sections = [
    '上下文使用规则：历史摘要或旧记录与最近原话冲突时，以最近原话为准；不要把未提及的旧内容强行带入当前回答。',
  ];
  if (input.launchContext) {
    const kindLabel = input.launchContext.kind === 'event'
      ? '事件'
      : input.launchContext.kind === 'reminder' ? '提醒' : '待办';
    if (input.launchContext.kind === 'reminder') {
      sections.push([
        `正在处理的${kindLabel}：${input.launchContext.label}`,
        input.launchContext.state ? `当前状态：${input.launchContext.state}` : '',
      ].filter(Boolean).join('\n'));
    } else {
      sections.push(`正在处理的${kindLabel} ID：${input.launchContext.id}\n需要真实状态时调用对应 get 工具读取。`);
    }
  }
  if (input.currentSummary) sections.push(`当前分段摘要：\n${input.currentSummary}`);
  if (input.workingSnapshots.length) {
    sections.push(`已有有效快照（版本仍有效，可直接复用；字段不足时再调用 get 工具）：\n${input.workingSnapshots.map(snapshot => (
      `- ${snapshot.id}｜读取于 ${snapshot.readAt}\n${JSON.stringify(snapshot.result)}`
    )).join('\n')}`);
  }
  if (input.memoryContext?.active.length) {
    sections.push(`已生效的长期记忆（可作为用户事实）：\n${input.memoryContext.active.map(item => (
      `- ${item.id}｜${item.category}｜${item.content}｜版本：${item.revision}`
    )).join('\n')}`);
  }
  if (input.memoryContext?.candidates.length) {
    sections.push(`相关记忆候选（未确认，不得作为事实或影响建议；仅用于判断重复、确认或纠正）：\n${input.memoryContext.candidates.map(item => (
      `- ${item.id}｜${item.category}｜${item.content}｜敏感性：${item.sensitivity}｜版本：${item.revision}`
    )).join('\n')}`);
  }
  if (input.segments.length) {
    sections.push(`相关历史分段：\n${input.segments.map(item => `- ${item.summary}`).join('\n')}`);
  }
  if (input.entries.length) {
    sections.push(`相关旧记录：\n${input.entries.map(item => `- ${item.text}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

function totalTokens(contextBlock: string, messages: ContextMessage[]): number {
  return estimateAssistantTokens(contextBlock)
    + messages.reduce((total, item) => total + estimateAssistantTokens(item.content) + 4, 0);
}

export function buildAssistantContext(input: AssistantContextInput): AssistantContextResult {
  const inputBudget = Math.max(128, input.inputBudget ?? DEFAULT_INPUT_BUDGET);
  const originalRecentCount = input.recentMessages.length;
  let recentMessages = input.recentMessages.slice(-MAX_RECENT_MESSAGES).map(item => ({ ...item }));
  let currentSummary = input.currentSegmentSummary?.trim() ?? '';
  const initialMemoryCount = (input.memoryContext?.active.length ?? 0) + (input.memoryContext?.candidates.length ?? 0);
  let memoryContext: AssistantMemoryContext = {
    active: [...(input.memoryContext?.active ?? [])],
    candidates: [...(input.memoryContext?.candidates ?? [])],
  };
  let workingSnapshots = [...(input.workingSnapshots ?? [])].sort((left, right) => right.readAt - left.readAt).slice(0, 4);
  const initialWorkingSnapshotCount = workingSnapshots.length;

  const seen = new Set<string>();
  let segments = rankByRelevance(input.retrievedSegments ?? [])
    .filter(item => item.summary.trim())
    .filter((item) => {
      if (!item.dedupeKey) return true;
      if (seen.has(item.dedupeKey)) return false;
      seen.add(item.dedupeKey);
      return true;
    })
    .slice(0, MAX_RETRIEVED_SEGMENTS);
  let entries = rankByRelevance(input.relevantEntries ?? [])
    .filter(item => item.text.trim())
    .filter((item) => {
      if (!item.dedupeKey) return true;
      if (seen.has(item.dedupeKey)) return false;
      seen.add(item.dedupeKey);
      return true;
    })
    .slice(0, MAX_RELEVANT_ENTRIES);

  const initialSegmentCount = segments.length;
  const initialEntryCount = entries.length;
  let contextBlock = renderContextBlock({
    launchContext: input.launchContext,
    currentSummary,
    segments,
    entries,
    memoryContext,
    workingSnapshots,
  });

  while (totalTokens(contextBlock, recentMessages) > inputBudget && entries.length) {
    entries = entries.slice(0, -1);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && segments.length) {
    segments = segments.slice(0, -1);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && memoryContext.candidates.length) {
    memoryContext = { ...memoryContext, candidates: memoryContext.candidates.slice(0, -1) };
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && memoryContext.active.length) {
    memoryContext = { ...memoryContext, active: memoryContext.active.slice(0, -1) };
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && workingSnapshots.length) {
    workingSnapshots = workingSnapshots.slice(0, -1);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && recentMessages.length > 1) {
    recentMessages = recentMessages.slice(1);
  }

  if (totalTokens(contextBlock, recentMessages) > inputBudget && currentSummary) {
    const messagesCost = totalTokens('', recentMessages);
    const fixedBlock = renderContextBlock({
      launchContext: input.launchContext,
      currentSummary: '',
      segments: [],
      entries: [],
      memoryContext,
      workingSnapshots,
    });
    const summaryBudget = Math.max(0, inputBudget - messagesCost - estimateAssistantTokens(fixedBlock) - 8);
    currentSummary = truncateToAssistantTokenBudget(currentSummary, summaryBudget);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries, memoryContext, workingSnapshots });
  }

  if (totalTokens(contextBlock, recentMessages) > inputBudget && recentMessages.length) {
    const fixedCost = estimateAssistantTokens(contextBlock) + 4;
    const newest = recentMessages[recentMessages.length - 1];
    recentMessages = [{
      ...newest,
      content: truncateToAssistantTokenBudget(newest.content, Math.max(1, inputBudget - fixedCost)),
    }];
  }

  return {
    contextBlock,
    recentMessages,
    selectedSegmentIds: segments.map(item => item.id),
    selectedEntryIds: entries.map(item => item.id),
    selectedMemoryIds: [...memoryContext.active, ...memoryContext.candidates].map(item => item.id),
    selectedWorkingSnapshotIds: workingSnapshots.map(item => item.id),
    estimatedTokens: totalTokens(contextBlock, recentMessages),
    stats: {
      inputBudget,
      trimmedRecentMessages: Math.max(0, originalRecentCount - recentMessages.length),
      trimmedSegments: initialSegmentCount - segments.length,
      trimmedEntries: initialEntryCount - entries.length,
      trimmedMemories: initialMemoryCount - memoryContext.active.length - memoryContext.candidates.length,
      trimmedWorkingSnapshots: initialWorkingSnapshotCount - workingSnapshots.length,
    },
  };
}
