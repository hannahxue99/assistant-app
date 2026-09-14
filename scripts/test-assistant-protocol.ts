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

const prompt = buildAssistantPromptMessages({
  contextBlock: '当前分段摘要：用户正在设计私人 AI。',
  recentMessages: [
    { id: '1', role: 'user', content: '这个方案可以', createdAt: 1 },
    { id: '2', role: 'assistant', content: '那继续梳理。', createdAt: 2 },
  ],
  referenceAt: new Date('2026-09-14T10:00:00+08:00').getTime(),
});
check(prompt[0].role === 'system', '首条必须是系统约束');
check(prompt[0].content.includes('不得声称已经创建'), '未接入对象操作前禁止虚假完成');
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
