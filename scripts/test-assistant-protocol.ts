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
check(parsed.memoryDeltas.length === 0, '旧返回未提供 memory_deltas 时应兼容为空数组');

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

const deletionOperations = parseAssistantTurnOutput(JSON.stringify({
  reply: '会按你的选择处理。',
  segment: { action: 'continue' },
  operations: [
    { key: 'delete-todo', type: 'delete_todo', todo_id: 'todo-existing' },
    { key: 'delete-event', type: 'delete_event', event_id: 'event-existing', linked_todo_policy: 'keep' },
  ],
}));
check(deletionOperations.operations[0].type === 'delete_todo', '应解析删除待办');
check(deletionOperations.operations[1].type === 'delete_event'
  && deletionOperations.operations[1].linkedTodoPolicy === 'keep', '应解析删除事件及关联待办策略');

const withEventDelta = parseAssistantTurnOutput(JSON.stringify({
  reply: '这条还款主线会持续很长时间。',
  segment: { action: 'continue' },
  event_deltas: [{
    target: { action: 'update_existing', event_id: 'event-loan' },
    evidence: ['贷款后续要30年左右结束'],
    state: {
      action: 'replace', change_type: 'fact',
      value: '已开始还款，预计还款周期约30年',
    },
    progress: [{ type: 'fact', content: '明确贷款还款周期约30年' }],
    todos: [],
  }],
}));
check(withEventDelta.eventDeltas.length === 1, '应解析完整事件增量');
const parsedDelta = withEventDelta.eventDeltas[0];
check(parsedDelta.key === 'event_delta_1', '事件增量键应由本地稳定生成，不依赖模型返回');
check(parsedDelta.target.action === 'update_existing' && parsedDelta.target.eventId === 'event-loan',
  '应解析已有事件目标');
check(parsedDelta.state.action === 'replace' && parsedDelta.progress.length === 1,
  '状态与关键进展必须保留为同一增量');

const ignoredModelDeltaKeys = parseAssistantTurnOutput(JSON.stringify({
  reply: '收到。', segment: { action: 'continue' },
  event_deltas: [
    {
      key: '../../unsafe', target: { action: 'update_existing', event_id: 'event-a' },
      evidence: ['原话'], state: { action: 'keep' }, progress: [], todos: [],
    },
    {
      key: '../../unsafe', target: { action: 'update_existing', event_id: 'event-b' },
      evidence: ['原话'], state: { action: 'keep' }, progress: [], todos: [],
    },
  ],
}));
check(ignoredModelDeltaKeys.eventDeltas.map(delta => delta.key).join(',') === 'event_delta_1,event_delta_2',
  '模型返回的内部 key 应被忽略，由本地按顺序重新生成');

const withMemoryDeltas = parseAssistantTurnOutput(JSON.stringify({
  reply: '以后会按这个习惯配合你。',
  segment: { action: 'continue' },
  memory_deltas: [
    {
      key: '../../unsafe', action: 'create_active', category: 'preference',
      content: '不喜欢早会', sensitivity: 'ordinary', admission_basis: 'explicit',
      evidence: '记住，我不喜欢早会',
    },
    {
      key: '../../unsafe', action: 'activate_candidate', memory_id: 'memory-old',
      expected_revision: 2, admission_basis: 'repeated', evidence: '重要决策先理清关键问题',
    },
  ],
}));
check(withMemoryDeltas.memoryDeltas.length === 2, '应解析长期记忆增量');
check(withMemoryDeltas.memoryDeltas.map(delta => delta.key).join(',') === 'memory_delta_1,memory_delta_2',
  '记忆增量键必须由本地稳定生成');
check(withMemoryDeltas.memoryDeltas[0].action === 'create_active'
  && withMemoryDeltas.memoryDeltas[0].admissionBasis === 'explicit',
'明确记住只能按 explicit 直接生效');

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
  ['删除事件缺少关联待办策略', [{ key: 'x', type: 'delete_event', event_id: 'event-a' }]],
  ['删除事件策略非法', [{ key: 'x', type: 'delete_event', event_id: 'event-a', linked_todo_policy: 'ask' }]],
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

for (const [label, delta] of [
  ['缺少证据', {
    key: 'x', target: { action: 'update_existing', event_id: 'event-a' }, evidence: [],
    state: { action: 'keep' }, progress: [], todos: [],
  }],
  ['keep 错带值', {
    key: 'x', target: { action: 'update_existing', event_id: 'event-a' }, evidence: ['原话'],
    state: { action: 'keep', value: '错误' }, progress: [], todos: [],
  }],
  ['replace 缺少值', {
    key: 'x', target: { action: 'update_existing', event_id: 'event-a' }, evidence: ['原话'],
    state: { action: 'replace', change_type: 'plan' }, progress: [], todos: [],
  }],
  ['未知目标动作', {
    key: 'x', target: { action: 'delete', event_id: 'event-a' }, evidence: ['原话'],
    state: { action: 'keep' }, progress: [], todos: [],
  }],
  ['取消待办未开放', {
    key: 'x', target: { action: 'update_existing', event_id: 'event-a' }, evidence: ['不做了'],
    state: { action: 'keep' }, progress: [{ type: 'decision', content: '计划取消' }],
    todos: [{ action: 'cancel', todo_id: 'todo-a' }],
  }],
] as const) {
  let rejected = false;
  try {
    parseAssistantTurnOutput(JSON.stringify({
      reply: '收到', segment: { action: 'continue' }, event_deltas: [delta],
    }));
  } catch (error) {
    rejected = error instanceof AssistantProtocolError;
  }
  check(rejected, `事件增量协议：${label}必须被拒绝`);
}

let tooManyDeltasRejected = false;
try {
  parseAssistantTurnOutput(JSON.stringify({
    reply: '收到', segment: { action: 'continue' },
    event_deltas: Array.from({ length: 3 }, (_, index) => ({
      key: `delta-${index}`, target: { action: 'update_existing', event_id: `event-${index}` },
      evidence: ['原话'], state: { action: 'keep' }, progress: [], todos: [],
    })),
  }));
} catch (error) {
  tooManyDeltasRejected = error instanceof AssistantProtocolError;
}
check(tooManyDeltasRejected, '单轮事件增量必须限制数量');

for (const [label, memoryDeltas] of [
  ['缺少证据', [{ action: 'create_candidate', category: 'preference', content: '喜欢茶', sensitivity: 'ordinary', admission_basis: 'inferred' }]],
  ['直接生效依据错误', [{ action: 'create_active', category: 'preference', content: '喜欢茶', sensitivity: 'ordinary', admission_basis: 'inferred', evidence: '喜欢茶' }]],
  ['未知类别', [{ action: 'create_candidate', category: 'account', content: '喜欢茶', sensitivity: 'ordinary', admission_basis: 'inferred', evidence: '喜欢茶' }]],
  ['非法版本', [{ action: 'forget_memory', memory_id: 'memory-a', expected_revision: 0, evidence: '忘掉' }]],
  ['超过两项', Array.from({ length: 3 }, () => ({ action: 'create_candidate', category: 'preference', content: '喜欢茶', sensitivity: 'ordinary', admission_basis: 'inferred', evidence: '喜欢茶' }))],
] as const) {
  let rejected = false;
  try {
    parseAssistantTurnOutput(JSON.stringify({
      reply: '收到', segment: { action: 'continue' }, memory_deltas: memoryDeltas,
    }));
  } catch (error) {
    rejected = error instanceof AssistantProtocolError;
  }
  check(rejected, `记忆增量协议：${label}必须被拒绝`);
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
check(prompt[0].content.includes('memory_deltas'), '提示词必须要求模型独立判断长期记忆');
check(prompt[0].content.includes('临时状态'), '提示词必须区分临时状态与长期记忆');
check(prompt[0].content.includes('关联的 N 条待办也一起删除吗'), '删除含待办事件时必须先确认级联范围');
check(prompt[0].content.includes('用户没有回答前什么都不删除'), '删除确认未答时不得提交操作');
check(prompt[0].content.includes('包括已完成和未完成'), '级联删除范围必须覆盖全部关联待办');
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
  check(providerResult.providerMetadata.attemptCount === 1
    && providerResult.providerMetadata.attempts[0].errorCode === null,
  '合法响应只应执行一次完整请求');
  check(!capturedBody.includes('secret'), 'API Key 不得进入请求 body');
  check(capturedBody.includes('fixture-model'), '请求应使用当前模型设置');
  check(capturedBody.includes('"stream":true'), 'Provider 必须启用流式返回');
  check(capturedBody.includes('"thinking":{"type":"enabled"}')
    && capturedBody.includes('"reasoning_effort":"high"'),
  'Provider 应显式开启 DeepSeek 思考并设置推理强度');
  check(providerResult.reasoning === null, '未返回思考内容时应保持空状态');

  const modelJson = JSON.stringify({
    reply: '下个月10号继续还款。',
    segment: { action: 'continue' },
    operations: [{
      key: 'todo', type: 'create_todo', todo_ref: 'todo_1', text: '继续还款',
      date_status: 'resolved', date_text: '下个月10号', due_date: '2026-10-10', time_precision: 'date',
    }],
  });
  const deltas = [modelJson.slice(0, 15), modelJson.slice(15, 27), modelJson.slice(27)];
  const reasoningEvent = `data: ${JSON.stringify({
    choices: [{ delta: { reasoning_content: '先判断是否需要建立待办。' }, finish_reason: null }],
  })}\n\n`;
  const sse = `${reasoningEvent}${deltas.map((content, index) => `data: ${JSON.stringify({
    choices: [{ delta: { content }, finish_reason: index === deltas.length - 1 ? 'stop' : null }],
    usage: index === deltas.length - 1 ? { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } : null,
  })}\n\n`).join('')}data: [DONE]\n\n`;
  const bytes = new TextEncoder().encode(sse);
  const streamedText: string[] = [];
  const streamedReasoning: string[] = [];
  const progressStages: string[] = [];
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
    onReasoningText: text => streamedReasoning.push(text),
    onProgress: stage => progressStages.push(stage),
  });
  check(streamed.reply === '下个月10号继续还款。', '流式 Provider 必须重组完整 JSON');
  check(streamedText.length > 1 && streamedText.at(-1) === streamed.reply, '自然回复应分段呈现并以完整回复结束');
  check(streamed.providerMetadata.totalTokens === 18 && streamed.providerMetadata.finishReason === 'stop',
    '流式元数据应记录 token usage 与结束原因');
  check(progressStages.includes('thinking') && progressStages.includes('answering'),
    '推理内容到达时应保持思考状态，reply 到达后应切换回答状态');
  check(!streamed.reply.includes('先判断是否需要建立待办'),
    '原始 reasoning_content 不得进入用户回复');
  check(streamed.reasoning?.content === '先判断是否需要建立待办。'
    && streamedReasoning.at(-1) === streamed.reasoning.content,
  '思考内容应流式更新并在完成后完整返回');

  let invalidResponseCalls = 0;
  let invalidResponseError: any = null;
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
        invalidResponseCalls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"reply":"收到","segment":{"action":"bad"}}' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
  } catch (error) {
    invalidResponseError = error;
  }
  check(invalidResponseCalls === 1, '协议损坏时不得自动发起第二次模型请求');
  check(invalidResponseError?.code === 'invalid-response'
    && invalidResponseError?.diagnostics?.attemptCount === 1
    && invalidResponseError?.diagnostics?.attempts[0]?.errorCode === 'invalid-response',
  '单次协议失败必须保留本次诊断状态');

  let unauthorizedCalls = 0;
  await requestAssistantTurn({
    settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
    context: { contextBlock: '上下文', recentMessages: [] },
    fetchImpl: async () => {
      unauthorizedCalls += 1;
      return new Response('unauthorized', { status: 401 });
    },
  }).then(() => { throw new Error('401 应失败'); }, () => {});
  check(unauthorizedCalls === 1, '鉴权错误不应自动重试');

  let rateLimitCalls = 0;
  await requestAssistantTurn({
    settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
    context: { contextBlock: '上下文', recentMessages: [] },
    fetchImpl: async () => {
      rateLimitCalls += 1;
      return new Response('slow down', { status: 429 });
    },
  }).then(() => { throw new Error('429 应失败'); }, () => {});
  check(rateLimitCalls === 1, '限流错误也不得自动发起第二次模型请求');

  let firstByteTimeoutError: any = null;
  try {
    await requestAssistantTurn({
      settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
      context: { contextBlock: '上下文', recentMessages: [] },
      timeouts: { firstByteMs: 20, streamIdleMs: 50, totalMs: 100 },
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });
  } catch (error) {
    firstByteTimeoutError = error;
  }
  check(firstByteTimeoutError?.code === 'timeout'
    && firstByteTimeoutError?.message.includes('等待回复开始'),
  '完全没有响应数据时应触发首包超时');

  let streamIdleError: any = null;
  try {
    await requestAssistantTurn({
      settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
      context: { contextBlock: '上下文', recentMessages: [] },
      timeouts: { firstByteMs: 50, streamIdleMs: 20, totalMs: 100 },
      fetchImpl: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
            choices: [{ delta: { reasoning_content: '仍在思考' }, finish_reason: null }],
          })}\n\n`));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    });
  } catch (error) {
    streamIdleError = error;
  }
  check(streamIdleError?.code === 'timeout' && streamIdleError?.message.includes('回复流中断'),
    '收到首个推理数据后长时间无新数据应触发流中断超时');

  let totalTimeoutError: any = null;
  try {
    await requestAssistantTurn({
      settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
      context: { contextBlock: '上下文', recentMessages: [] },
      timeouts: { firstByteMs: 50, streamIdleMs: 30, totalMs: 55 },
      fetchImpl: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const emit = () => controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            choices: [{ delta: { reasoning_content: '持续思考' }, finish_reason: null }],
          })}\n\n`));
          emit();
          const interval = setInterval(emit, 10);
          init?.signal?.addEventListener('abort', () => {
            clearInterval(interval);
            controller.error(new Error('aborted'));
          }, { once: true });
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    });
  } catch (error) {
    totalTimeoutError = error;
  }
  check(totalTimeoutError?.code === 'timeout' && totalTimeoutError?.message.includes('回复处理超时'),
    '流持续活跃时仍应遵守总时长上限');

  const cancelController = new AbortController();
  let cancellationCalls = 0;
  const cancelledRequest = requestAssistantTurn({
    settings: { llmEnabled: true, llmBaseUrl: 'https://example.test/v1', llmKey: 'secret', llmModel: 'fixture-model' },
    context: { contextBlock: '上下文', recentMessages: [] },
    signal: cancelController.signal,
    fetchImpl: async (_url, init) => {
      cancellationCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  await Promise.resolve();
  cancelController.abort();
  let cancellationError: any = null;
  try {
    await cancelledRequest;
  } catch (error) {
    cancellationError = error;
  }
  check(cancellationCalls === 1, '用户停止后不得再自动请求第二次');
  check(cancellationError?.code === 'cancelled', '主动停止必须与网络失败区分');

  console.log('assistant protocol tests passed');
}

void main();
