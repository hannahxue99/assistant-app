import { buildAssistantContext, type ContextMessage } from '../src/assistant/context';
import { buildAssistantPromptMessages } from '../src/assistant/prompt';
import { rankRelevantSegments } from '../src/assistant/retrieval';
import type { ConversationSegment } from '../src/assistant/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function message(index: number, content: string): ContextMessage {
  return { id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content, createdAt: index };
}

// 1. 最近指代：最近原话必须原样保留，交给模型解析“它”。
const nearby = buildAssistantContext({
  recentMessages: [
    message(0, '我想周四整理照片'),
    message(1, '你想先筛废片还是分类？'),
    message(2, '先处理它最容易开始的部分'),
  ],
});
check(nearby.recentMessages.length === 3, '近距离指代不能被摘要替代');
check(nearby.recentMessages[0].content.includes('照片'), '指代对象原话必须仍在窗口中');

// 2. 回到旧主线：明显最佳段被召回，相似但不同的段不一起污染。
const oldSegments: ConversationSegment[] = [
  { id: 'sort', summary: '照片整理：用户决定先筛废片，再按月份分类。', status: 'closed', startedAt: 1, endedAt: 2, updatedAt: 2 },
  { id: 'backup', summary: '照片备份：考虑购买云存储空间。', status: 'closed', startedAt: 3, endedAt: 4, updatedAt: 4 },
  { id: 'review', summary: '产品评审：确认小知页面方案。', status: 'closed', startedAt: 5, endedAt: 6, updatedAt: 6 },
];
const returned = rankRelevantSegments('我们继续聊照片整理', oldSegments);
check(returned[0]?.id === 'sort', '返回旧话题时必须找回正确主线');
check(!returned.some(item => item.id === 'review'), '无关主线不得进入上下文');

// 3. 最近纠正优先：旧摘要可存在，但规则必须明确采用最新原话。
const corrected = buildAssistantContext({
  currentSegmentSummary: '用户计划周四一次整理完所有照片。',
  recentMessages: [message(10, '我改主意了，周四只筛废片，不要求一次做完。')],
});
check(corrected.contextBlock.includes('最近原话为准'), '旧摘要冲突时必须有明确优先级');
check(corrected.recentMessages[0].content.includes('改主意'), '用户纠正必须完整保留');

// 4. 长历史成本：600 条历史不能改变最近窗口和预算上限。
const many = buildAssistantContext({
  recentMessages: Array.from({ length: 600 }, (_, index) => message(index, `历史消息${index}`.repeat(20))),
  currentSegmentSummary: '长期对话摘要'.repeat(30),
  inputBudget: 6000,
});
check(many.recentMessages.length <= 12, '长历史仍只能保留最近 6 轮原话');
check(many.recentMessages.at(-1)?.id === 'm599', '最新消息不得被长历史挤掉');
check(many.estimatedTokens <= 6000, '长历史输入必须受硬预算约束');

// 5. 上下文入口：从事件进入时，显式事件状态优先于模糊检索。
const launched = buildAssistantContext({
  recentMessages: [message(1, '现在处理吧')],
  launchContext: { kind: 'event', id: 'photo', label: '照片整理', state: '周四先筛废片' },
});
check(launched.contextBlock.includes('正在处理的事件：照片整理'), '事件入口必须携带明确主线');
check(launched.contextBlock.includes('周四先筛废片'), '事件当前状态必须进入上下文');

// 6. 已有主线中的未来行动承诺：模型必须被明确要求同时建立关联待办。
const repaymentContext = buildAssistantContext({
  recentMessages: [message(20, '下个月11号还款10万')],
  launchContext: {
    kind: 'event',
    id: 'loan',
    label: '公积金贷款还款',
    state: '已还30万，剩余约30多万',
  },
});
const repaymentPrompt = buildAssistantPromptMessages({
  contextBlock: repaymentContext.contextBlock,
  recentMessages: repaymentContext.recentMessages,
  referenceAt: new Date('2026-09-15T16:15:00+08:00').getTime(),
  timeZone: 'Asia/Shanghai',
})[0].content;
check(repaymentPrompt.includes('event_deltas'),
  '已有事件中的明确未来行动必须通过完整事件增量判断');
check(repaymentPrompt.includes('合并旧状态后的完整新快照'),
  '当前状态必须保留仍有效的旧事实，而不是只抄本轮消息');
check(repaymentPrompt.includes('本轮用户原话'),
  '事件变化必须提供来自本轮用户消息的证据');
check(repaymentPrompt.includes('自动关联'),
  '增量待办必须由本地自动关联事件');
check(repaymentPrompt.includes('"due_date":"2026-10-11"'),
  '真实还款正例必须给出模型解析后的日期');
check(repaymentPrompt.includes('银行说下个月可能调整利率'),
  '质量约束必须排除外部可能性，避免泛化为待办');

console.log('assistant multi-turn quality tests passed');
