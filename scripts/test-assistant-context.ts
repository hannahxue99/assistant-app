import {
  buildAssistantContext,
  estimateAssistantTokens,
  type ContextMessage,
} from '../src/assistant/context';

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

console.log('assistant context tests passed');
