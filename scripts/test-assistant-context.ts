import {
  buildAssistantContext,
  estimateAssistantTokens,
  type ContextMessage,
} from '../src/assistant/context';
import { selectMemoryContext } from '../src/assistant/memory-context';
import type { AssistantMemory } from '../src/assistant/memory-types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function message(index: number): ContextMessage {
  return {
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `第${index}条最近原话`,
    createdAt: index,
  };
}

function memory(index: number, status: 'active' | 'candidate' = 'active'): AssistantMemory {
  return {
    id: `memory-${status}-${index}`,
    category: index % 2 ? 'preference' : 'principle',
    content: index === 0 ? '重要决策先理清关键问题' : `长期记忆内容${index}`,
    normalizedContent: `memory${index}`,
    status,
    sensitivity: 'ordinary',
    admissionBasis: status === 'active' ? 'explicit' : 'inferred',
    supersededById: null,
    revision: 1,
    createdAt: index,
    updatedAt: index,
    activatedAt: status === 'active' ? index : null,
    supersededAt: null,
    forgottenAt: null,
  };
}

const result = buildAssistantContext({
  recentMessages: Array.from({ length: 14 }, (_, index) => message(index)),
  currentSegmentSummary: '当前正在讨论照片整理，用户决定先筛废片。',
  retrievedSegments: Array.from({ length: 5 }, (_, index) => ({
    id: `s${index}`,
    summary: `历史分段${index}`,
    relevance: 1 - index * 0.1,
    updatedAt: 100 - index,
    dedupeKey: index === 4 ? 'same-source' : undefined,
  })),
  relevantEntries: Array.from({ length: 7 }, (_, index) => ({
    id: `e${index}`,
    text: `旧记录${index}`,
    relevance: 1 - index * 0.05,
    updatedAt: 200 - index,
    dedupeKey: index === 6 ? 'same-source' : undefined,
  })),
  launchContext: { kind: 'event', id: 'photo', label: '照片整理', state: '周四先筛废片' },
  inputBudget: 6000,
});

check(result.recentMessages.length === 12, '最近原话最多保留 12 条');
check(result.recentMessages[0].id === 'm2', '应裁掉最老两条而保留最新窗口');
check(result.selectedSegmentIds.length === 3, '相关历史分段最多 3 个');
check(result.selectedEntryIds.length === 5, '相关旧记录最多 5 条');
check(result.contextBlock.includes('最近原话为准'), '必须明确最近事实优先规则');
check(result.contextBlock.indexOf('当前分段摘要') < result.contextBlock.indexOf('相关历史分段'), '当前摘要必须先于旧段');
check(result.contextBlock.indexOf('正在处理的事件') < result.contextBlock.indexOf('当前分段摘要'), '显式启动上下文优先');

const deduped = buildAssistantContext({
  recentMessages: [message(1), message(2)],
  retrievedSegments: [{ id: 's', summary: '同一来源摘要', relevance: 1, updatedAt: 1, dedupeKey: 'source-1' }],
  relevantEntries: [{ id: 'e', text: '同一来源原声', relevance: 1, updatedAt: 1, dedupeKey: 'source-1' }],
  inputBudget: 1000,
});
check(deduped.selectedSegmentIds.length === 1, '更高优先级的历史段应保留');
check(deduped.selectedEntryIds.length === 0, '同一来源不得在旧记录中重复进入上下文');

const budgeted = buildAssistantContext({
  recentMessages: Array.from({ length: 12 }, (_, index) => ({
    ...message(index),
    content: `最近事实${index}`.repeat(8),
  })),
  currentSegmentSummary: '当前摘要'.repeat(12),
  retrievedSegments: Array.from({ length: 3 }, (_, index) => ({
    id: `bs${index}`,
    summary: `较远历史${index}`.repeat(15),
    relevance: 1 - index * 0.1,
    updatedAt: index,
  })),
  relevantEntries: Array.from({ length: 5 }, (_, index) => ({
    id: `be${index}`,
    text: `低优先级旧记录${index}`.repeat(15),
    relevance: 1 - index * 0.1,
    updatedAt: index,
  })),
  inputBudget: 460,
});
check(budgeted.estimatedTokens <= 460, '最终上下文不得超过硬预算');
check(budgeted.selectedEntryIds.length === 0, '超限时应先裁掉低优先级旧记录');
check(budgeted.recentMessages.at(-1)?.id === 'm11', '无论裁剪都必须保留最新消息');
check(budgeted.stats.trimmedRecentMessages >= 0, '应输出可观测的裁剪统计');

check(estimateAssistantTokens('这是六个汉字') >= 6, '中文 Token 估算必须保守');
check(estimateAssistantTokens('abcdefghijkl') <= 4, '连续拉丁字符按近似 token 估算');

const linkedTodoContext = buildAssistantContext({
  recentMessages: [message(30)],
  actionContext: {
    events: [{
      id: 'event-loan', title: '公积金贷款还款', currentState: '计划继续提前还款',
      aliases: [], linkedTodoTexts: ['10月11日还款10万'], recentUpdateTexts: [],
      linkedTodos: [
        {
          id: 'todo-open', text: '10月11日还款10万', dueAt: new Date(2026, 9, 11, 9).getTime(),
          done: false, revisionAt: 7, updatedAt: 7,
        },
        {
          id: 'todo-done', text: '9月15日提前还款30万', dueAt: new Date(2026, 8, 15, 9).getTime(),
          done: true, revisionAt: 6, updatedAt: 6,
        },
      ],
      revision: 2, updatedAt: 8, score: 10,
    }],
    todos: [], explicitEventId: 'event-loan', segmentEventId: null,
  },
});
check(linkedTodoContext.contextBlock.includes('todo-open'), '事件上下文必须提供相关待办 ID');
check(linkedTodoContext.contextBlock.includes('未完成'), '事件上下文必须提供相关待办状态');
check(linkedTodoContext.contextBlock.includes('todo-done'), '最近完成的相关待办必须进入上下文');
check(linkedTodoContext.contextBlock.includes('2026'), '事件上下文必须提供相关待办日期');

const crowdedEventContext = buildAssistantContext({
  recentMessages: Array.from({ length: 12 }, (_, index) => ({
    ...message(100 + index), content: `最近事件原话${index}`.repeat(20),
  })),
  actionContext: {
    events: Array.from({ length: 5 }, (_, eventIndex) => ({
      id: `event-${eventIndex}`, title: `事件${eventIndex}`, currentState: '当前状态'.repeat(30),
      aliases: [], linkedTodoTexts: [], recentUpdateTexts: [], revision: 1,
      updatedAt: eventIndex, score: 10 - eventIndex,
      linkedTodos: Array.from({ length: 11 }, (_, todoIndex) => ({
        id: `event-${eventIndex}-todo-${todoIndex}`,
        text: `需要处理的相关行动${todoIndex}`.repeat(15),
        dueAt: null,
        done: todoIndex >= 8,
        revisionAt: todoIndex,
        updatedAt: todoIndex,
      })),
    })),
    todos: [], explicitEventId: 'event-0', segmentEventId: null,
  },
  inputBudget: 6000,
});
check(crowdedEventContext.estimatedTokens <= 6000, '丰富事件包仍不得突破上下文硬预算');

const selectedMemoryContext = selectMemoryContext(
  '这个重要决策先理清什么？',
  Array.from({ length: 20 }, (_, index) => memory(index)),
  [
    { ...memory(30, 'candidate'), content: '重要决策前先列关键问题' },
    { ...memory(31, 'candidate'), content: '完全不相关的早餐口味' },
  ],
);
check(selectedMemoryContext.active.length <= 12, '生效记忆最多进入 12 条');
check(selectedMemoryContext.candidates.length === 1, '只带入与当前消息相关的候选');
const renderedMemoryContext = buildAssistantContext({
  recentMessages: [message(200)],
  memoryContext: selectedMemoryContext,
  inputBudget: 1600,
});
check(renderedMemoryContext.contextBlock.includes('可作为用户事实'), 'active 必须明确为可用事实');
check(renderedMemoryContext.contextBlock.includes('不得作为事实或影响建议'), 'candidate 必须带未确认隔离规则');
check(renderedMemoryContext.selectedMemoryIds.length
  === selectedMemoryContext.active.length + selectedMemoryContext.candidates.length,
'上下文必须记录实际发送的记忆引用');

console.log('assistant context tests passed');
