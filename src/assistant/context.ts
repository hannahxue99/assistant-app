import { estimateAssistantTokens, truncateToAssistantTokenBudget } from './token-budget';

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
  inputBudget?: number;
}

export interface AssistantContextResult {
  contextBlock: string;
  recentMessages: ContextMessage[];
  selectedSegmentIds: string[];
  selectedEntryIds: string[];
  estimatedTokens: number;
  stats: {
    inputBudget: number;
    trimmedRecentMessages: number;
    trimmedSegments: number;
    trimmedEntries: number;
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
}): string {
  const sections = [
    '上下文使用规则：历史摘要或旧记录与最近原话冲突时，以最近原话为准；不要把未提及的旧内容强行带入当前回答。',
  ];
  if (input.launchContext) {
    const kindLabel = input.launchContext.kind === 'event'
      ? '事件'
      : input.launchContext.kind === 'reminder' ? '提醒' : '待办';
    sections.push([
      `正在处理的${kindLabel}：${input.launchContext.label}`,
      input.launchContext.state ? `当前状态：${input.launchContext.state}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (input.currentSummary) sections.push(`当前分段摘要：\n${input.currentSummary}`);
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
  });

  while (totalTokens(contextBlock, recentMessages) > inputBudget && entries.length) {
    entries = entries.slice(0, -1);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries });
  }
  while (totalTokens(contextBlock, recentMessages) > inputBudget && segments.length) {
    segments = segments.slice(0, -1);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries });
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
    });
    const summaryBudget = Math.max(0, inputBudget - messagesCost - estimateAssistantTokens(fixedBlock) - 8);
    currentSummary = truncateToAssistantTokenBudget(currentSummary, summaryBudget);
    contextBlock = renderContextBlock({ launchContext: input.launchContext, currentSummary, segments, entries });
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
    estimatedTokens: totalTokens(contextBlock, recentMessages),
    stats: {
      inputBudget,
      trimmedRecentMessages: Math.max(0, originalRecentCount - recentMessages.length),
      trimmedSegments: initialSegmentCount - segments.length,
      trimmedEntries: initialEntryCount - entries.length,
    },
  };
}
