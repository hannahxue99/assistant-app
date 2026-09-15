import { buildAssistantPromptMessages } from '../src/assistant/prompt';
import {
  AssistantProtocolError,
  inspectAssistantReplyWarnings,
  parseAssistantTurnOutput,
} from '../src/assistant/protocol';
import { requestAssistantTurn } from '../src/assistant/provider';
import { extractPartialJsonStringField } from '../src/assistant/streaming-json';

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
      text: '周六去看第二套房', date_status: 'resolved', date_text: '周六',
      due_date: '2026-09-19', time_precision: 'date',
    },
    {
      key: 'link', type: 'link_todo_event', todo_ref: 'todo_1', event_ref: 'event_1',
    },
  ],
}));
check(withOperations.operations.length === 3, '应解析同轮事件、待办及关联动作');
check(withOperations.operations[0].type === 'create_event', '应保留动作判别字段');
check(withOperations.operations[2].type === 'link_todo_event', '应解析本地引用关系');
const parsedTodo = withOperations.operations[1];
check(parsedTodo.type === 'create_todo' && parsedTodo.dueDate === '2026-09-19', '日期必须由模型解析为本地日期');

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

const completionClaim = parseAssistantTurnOutput(
  '{"reply":"好的，记下了","segment":{"action":"continue"},"operations":[]}',
);
check(completionClaim.reply.includes('记下了'), '自然成功措辞不应让完整回复失败');
check(inspectAssistantReplyWarnings(completionClaim.reply).includes('reply_execution_claim'),
  '自然成功措辞应作为非致命协议告警记录');

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
  ['新待办缺少日期判断', [{ key: 'x', type: 'create_todo', todo_ref: 'todo_1', text: '买牛奶' }]],
  ['resolved 缺少日期', [{ key: 'x', type: 'create_todo', todo_ref: 'todo_1', text: '买牛奶', date_status: 'resolved', date_text: '明天', time_precision: 'date' }]],
  ['date 状态却带时间', [{ key: 'x', type: 'create_todo', todo_ref: 'todo_1', text: '买牛奶', date_status: 'resolved', date_text: '明天', due_date: '2026-09-16', due_time: '09:00', time_precision: 'date' }]],
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
check(prompt[0].content.includes('事件与待办不是二选一'), '提示词必须允许同轮事件与待办');
check(prompt[0].content.includes('陈述句而不是“提醒我”'), '提示词必须把用户明确的未来行动承诺识别为待办');
check(prompt[0].content.includes('下个月11号还款10万'), '提示词必须包含真实遗漏场景的正例');
check(prompt[0].content.includes('银行说下个月可能调整利率'), '提示词必须包含非用户承诺的反例');
check(prompt[0].content.includes('due_date'), '提示词必须要求模型解析日期');
check(prompt.at(-1)?.content === '那继续梳理。', '最近原话必须保持角色与顺序');
check(extractPartialJsonStringField('{"reply":"第一行\\n第', 'reply') === '第一行\n第',
  '流式 JSON 应解码完整转义并保留未闭合回复');

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
  check(providerResult.providerMetadata.repairCount === 0
    && providerResult.providerMetadata.repairStatus === 'not_needed',
  '合法响应不得增加修复调用');
  check(!capturedBody.includes('secret'), 'API Key 不得进入请求 body');
  check(capturedBody.includes('fixture-model'), '请求应使用当前模型设置');
  check(capturedBody.includes('"stream":true'), 'Provider 必须启用流式返回');

  const modelJson = JSON.stringify({
    reply: '下个月10号继续还款。',
    segment: { action: 'continue' },
    operations: [{
      key: 'todo', type: 'create_todo', todo_ref: 'todo_1', text: '继续还款',
      date_status: 'resolved', date_text: '下个月10号', due_date: '2026-10-10', time_precision: 'date',
    }],
  });
  const deltas = [modelJson.slice(0, 15), modelJson.slice(15, 27), modelJson.slice(27)];
  const sse = `${deltas.map((content, index) => `data: ${JSON.stringify({
    choices: [{ delta: { content }, finish_reason: index === deltas.length - 1 ? 'stop' : null }],
    usage: index === deltas.length - 1 ? { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } : null,
  })}\n\n`).join('')}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(sse);
  const streamedText: string[] = [];
  const streamed = await requestAssistantTurn({
    settings: {
      llmEnabled: true,
      llmBaseUrl: 'https://example.test/v1',
      llmKey: 'secret',
      llmModel: 'fixture-model',
    },
    context: {
      contextBlock: '上下文',
      recentMessages: [{ id: 'u', role: 'user', content: '下个月10号还', createdAt: 1 }],
    },
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    onReplyText: text => streamedText.push(text),
  });
  check(streamed.reply === '下个月10号继续还款。', '流式 Provider 必须重组完整 JSON');
  check(streamedText.length > 1 && streamedText.at(-1) === streamed.reply, '自然回复应分段呈现并以完整回复结束');
  check(streamed.providerMetadata.totalTokens === 18 && streamed.providerMetadata.finishReason === 'stop',
    '流式元数据应记录 token usage 与结束原因');

  const repairBodies: string[] = [];
  let repairCalls = 0;
  const repaired = await requestAssistantTurn({
    settings: {
      llmEnabled: true,
      llmBaseUrl: 'https://example.test/v1',
      llmKey: 'secret',
      llmModel: 'fixture-model',
    },
    context: {
      contextBlock: '不应在修复请求里重复的私密历史上下文',
      recentMessages: [{ id: 'u', role: 'user', content: '不应重复发送的历史原话', createdAt: 1 }],
    },
    referenceAt: new Date('2026-09-15T15:39:06+08:00').getTime(),
    timeZone: 'Asia/Shanghai',
    fetchImpl: async (_url, init) => {
      repairBodies.push(String(init?.body));
      repairCalls += 1;
      const content = repairCalls === 1
        ? '{"reply":"好的，记下了","segment":{"action":"continue"},"operations":[{"key":"todo","type":"create_todo","todo_ref":"todo_1","text":"还款10万","date_status":"resolved","date_text":"下个月11号"}]}'
        : '{"reply":"好的，记下了","segment":{"action":"continue"},"operations":[{"key":"todo","type":"create_todo","todo_ref":"todo_1","text":"还款10万","date_status":"resolved","date_text":"下个月11号","due_date":"2026-10-11","time_precision":"date"}]}';
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  check(repairCalls === 2, '协议损坏时最多追加一次格式修复请求');
  check(repaired.operations[0].type === 'create_todo', '修复结果必须重新通过同一严格协议');
  check(repaired.providerMetadata.repairCount === 1 && repaired.providerMetadata.repairStatus === 'succeeded',
    'Provider 元数据应标记修复成功');
  check(repaired.providerMetadata.totalTokens === 22, '修复调用的 token 应合并计入本轮');
  check(!repairBodies[1].includes('私密历史上下文') && !repairBodies[1].includes('历史原话'),
    '格式修复不得重复携带完整上下文');
  check(repaired.providerMetadata.protocolWarnings.includes('reply_execution_claim'),
    '修复后的自然成功措辞应记录为告警但不导致失败');

  let failedRepairCalls = 0;
  let failedRepairError: any = null;
  try {
    await requestAssistantTurn({
      settings: {
        llmEnabled: true,
        llmBaseUrl: 'https://example.test/v1',
        llmKey: 'secret',
        llmModel: 'fixture-model',
      },
      context: { contextBlock: '上下文', recentMessages: [] },
      fetchImpl: async () => {
        failedRepairCalls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"reply":"收到","segment":{"action":"bad"}}' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
  } catch (error) {
    failedRepairError = error;
  }
  check(failedRepairCalls === 2, '首次和修复都损坏时也只能调用两次，不能无限修复');
  check(failedRepairError?.code === 'invalid-response'
    && failedRepairError?.diagnostics?.repairStatus === 'failed',
  '修复仍失败时必须携带精确诊断状态');

  console.log('assistant protocol tests passed');
}

void main();
