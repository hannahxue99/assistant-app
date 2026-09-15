import { buildAssistantPromptMessages } from '../src/assistant/prompt';
import { AssistantProtocolError, parseAssistantTurnOutput } from '../src/assistant/protocol';
import { requestAssistantTurn } from '../src/assistant/provider';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const parsed = parseAssistantTurnOutput(JSON.stringify({
  reply: '我们先从最小一步开始。',
  segment: { action: 'continue', summary: '用户决定先完成最小一步。' },
}));
check(parsed.reply === '我们先从最小一步开始。', '应解析自然回复');
check(parsed.segment.action === 'continue', '应解析分段动作');
check(parsed.operations.length === 0, '旧返回未提供 operations 时应兼容为空数组');

const withOperations = parseAssistantTurnOutput(JSON.stringify({
  reply: '可以，我们把它作为一条持续主线。',
  segment: { action: 'continue' },
  operations: [
    {
      key: 'event-create', type: 'create_event', event_ref: 'event_1',
      title: '换房计划', current_state: '开始看房',
    },
    {
      key: 'todo-create', type: 'create_todo', todo_ref: 'todo_1',
      text: '周六去看第二套房', date_text: '周六',
    },
    {
      key: 'link', type: 'link_todo_event', todo_ref: 'todo_1', event_ref: 'event_1',
    },
  ],
}));
check(withOperations.operations.length === 3, '应解析同轮事件、待办及关联动作');
check(withOperations.operations[0].type === 'create_event', '应保留动作判别字段');
check(withOperations.operations[2].type === 'link_todo_event', '应解析本地引用关系');

const existingOperations = parseAssistantTurnOutput(JSON.stringify({
  reply: '这条主线有了新进展。',
  segment: { action: 'continue' },
  operations: [
    { key: 'state', type: 'update_event', event_id: 'event-existing', current_state: '已完成面试' },
    { key: 'done', type: 'complete_todo', todo_id: 'todo-existing' },
  ],
}));
check(existingOperations.operations[0].type === 'update_event', '应解析候选事件更新');
check(existingOperations.operations[1].type === 'complete_todo', '应解析候选待办完成');

const fenced = parseAssistantTurnOutput('```json\n{"reply":"好的","segment":{"action":"split_before_user","previous_summary":"旧话题结束","summary":"新话题开始"}}\n```');
check(fenced.segment.action === 'split_before_user', '应容忍 JSON 代码块');
check(fenced.segment.previousSummary === '旧话题结束', '应规范化 snake_case 字段');

const longSummary = parseAssistantTurnOutput(JSON.stringify({
  reply: '收到。',
  segment: { action: 'continue', summary: '很'.repeat(500) },
}));
check((longSummary.segment.summary?.length ?? 0) <= 240, '摘要必须有硬长度上限');

for (const invalid of [
  '{}',
  '{"reply":"","segment":{"action":"continue"}}',
  '{"reply":"好","segment":{"action":"unknown"}}',
]) {
  let rejected = false;
  try {
    parseAssistantTurnOutput(invalid);
  } catch (error) {
    rejected = error instanceof AssistantProtocolError;
  }
  check(rejected, `非法返回必须拒绝：${invalid}`);
}

for (const [label, operations] of [
  ['重复操作键', [
    { key: 'same', type: 'complete_todo', todo_id: 'todo-a' },
    { key: 'same', type: 'complete_todo', todo_id: 'todo-b' },
  ]],
  ['未知动作', [{ key: 'x', type: 'delete_everything' }]],
  ['非法候选 ID', [{ key: 'x', type: 'complete_todo', todo_id: '../../todo' }]],
  ['超过六个动作', Array.from({ length: 7 }, (_, index) => ({
    key: `done-${index}`, type: 'complete_todo', todo_id: `todo-${index}`,
  }))],
  ['字段过长', [{ key: 'x', type: 'create_event', event_ref: 'event_1', title: '事'.repeat(121), current_state: '开始' }]],
  ['错误本地引用', [{ key: 'x', type: 'create_event', event_ref: 'event-x', title: '换房', current_state: '开始' }]],
] as const) {
  let rejected = false;
  try {
    parseAssistantTurnOutput(JSON.stringify({
      reply: '收到', segment: { action: 'continue' }, operations,
    }));
  } catch (error) {
    rejected = error instanceof AssistantProtocolError;
  }
  check(rejected, `${label}必须被协议层拒绝`);
}

const prompt = buildAssistantPromptMessages({
  contextBlock: '当前分段摘要：用户正在设计私人 AI。',
  recentMessages: [
    { id: '1', role: 'user', content: '这个方案可以', createdAt: 1 },
    { id: '2', role: 'assistant', content: '那继续梳理。', createdAt: 2 },
  ],
  referenceAt: new Date('2026-09-14T10:00:00+08:00').getTime(),
});
check(prompt[0].role === 'system', '首条必须是系统约束');
check(prompt[0].content.includes('不得在自然回复中声称操作已经成功'), '自然回复必须禁止虚假完成');
check(prompt[0].content.includes('operations'), '提示词必须声明结构化候选动作');
check(prompt.at(-1)?.content === '那继续梳理。', '最近原话必须保持角色与顺序');

async function main() {
  let capturedBody = '';
  const providerResult = await requestAssistantTurn({
    settings: {
      llmEnabled: true,
      llmBaseUrl: 'https://example.test/v1/',
      llmKey: 'secret',
      llmModel: 'fixture-model',
    },
    context: {
      contextBlock: '上下文',
      recentMessages: [{ id: 'u', role: 'user', content: '继续', createdAt: 1 }],
    },
    referenceAt: 1,
    fetchImpl: async (_url, init) => {
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"继续推进","segment":{"action":"continue"}}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  check(providerResult.reply === '继续推进', 'Provider 应返回校验后的结果');
  check(!capturedBody.includes('secret'), 'API Key 不得进入请求 body');
  check(capturedBody.includes('fixture-model'), '请求应使用当前模型设置');

  console.log('assistant protocol tests passed');
}

void main();
