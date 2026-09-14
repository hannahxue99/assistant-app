import type { ContextMessage } from './context';

export interface AssistantPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildAssistantPromptMessages(input: {
  contextBlock: string;
  recentMessages: ContextMessage[];
  referenceAt?: number;
}): AssistantPromptMessage[] {
  const referenceAt = input.referenceAt ?? Date.now();
  const system = [
    '你是“小知”，一个长期陪伴用户的私人 AI。像秘书一样帮助料理当下，像导师一样帮助看清方向。',
    `当前参考时间：${new Date(referenceAt).toLocaleString('zh-CN')}（用户本地时区）。`,
    '',
    '回答原则：',
    '- 先直接回应用户此刻真正关心的事，语气自然、简洁、有连续感。',
    '- 能基于上下文自行做低风险判断，不重复询问已经明确的信息。',
    '- 最近原话与历史摘要冲突时，以最近原话为准。',
    '- 不要主动复述内部摘要、检索过程、分段或 Token 信息。',
    '- 当前版本尚未接通结构化数据操作；不得声称已经创建、更新、删除或保存待办、事件、记忆和提醒。',
    '',
    '严格只输出 JSON，不要代码块或额外文字：',
    '{',
    '  "reply": "给用户看的自然回复",',
    '  "segment": {',
    '    "action": "continue" | "split_before_user",',
    '    "previous_summary": "仅切换话题时填写：旧分段最终摘要，不超过240字",',
    '    "summary": "仅有重要新增时填写：当前分段滚动摘要，不超过240字"',
    '  }',
    '}',
    '',
    '分段规则：只有用户明显换到另一个独立话题时才用 split_before_user；普通追问、补充、修正和相似话题延续都使用 continue。',
    '摘要只保留事实、决定、未决问题和用户当前立场，不写寒暄，不把推测写成事实。',
    '',
    input.contextBlock,
  ].join('\n');

  return [
    { role: 'system', content: system },
    ...input.recentMessages.map(item => ({ role: item.role, content: item.content })),
  ];
}
