import {
  ASSISTANT_WEB_SEARCH_TOOL,
  deepSeekAnthropicMessagesUrl,
  executeDeepSeekWebSearch,
  parseDeepSeekWebSearchResponse,
  webSearchSettingsState,
} from '../src/assistant/web-search';
import { requestAssistantTurn } from '../src/assistant/provider';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(
  deepSeekAnthropicMessagesUrl('https://api.deepseek.com/v1')
    === 'https://api.deepseek.com/anthropic/v1/messages',
  'DeepSeek OpenAI 地址应转换为官方 Anthropic Messages 地址',
);
check(deepSeekAnthropicMessagesUrl('https://example.com/v1') === null,
  '自定义兼容服务不得误判为 DeepSeek 原生搜索');
check(ASSISTANT_WEB_SEARCH_TOOL.function.name === 'web_search',
  '主模型应看到稳定的 web_search 工具名');

const ready = webSearchSettingsState({
  llmEnabled: true,
  llmBaseUrl: 'https://api.deepseek.com/v1',
  llmKey: 'secret',
  llmModel: 'deepseek-flash',
  webSearchEnabled: true,
});
check(ready.status === 'ready' && ready.enabled, '完整 DeepSeek 配置应允许联网搜索');
check(webSearchSettingsState({ ...ready.settings, webSearchEnabled: false }).status === 'disabled',
  '用户关闭联网搜索时必须保持关闭状态');
check(webSearchSettingsState({ ...ready.settings, llmKey: '' }).status === 'missing-key',
  '缺少理解引擎 Key 时联网搜索应提示配置');
check(webSearchSettingsState({ ...ready.settings, llmBaseUrl: 'https://example.com/v1' }).status === 'unsupported',
  '非 DeepSeek 服务应明确标记不支持');

const parsed = parseDeepSeekWebSearchResponse({
  usage: { server_tool_use: { web_search_requests: 2 } },
  content: [
    { type: 'text', text: '先搜索。' },
    {
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', title: '官方说明', url: 'https://example.com/doc#part', encrypted_content: 'cipher' },
        { type: 'web_search_result', title: '重复来源', url: 'https://example.com/doc', encrypted_content: 'cipher-2' },
        { type: 'web_search_result', title: '危险来源', url: 'file:///etc/passwd', encrypted_content: 'cipher-3' },
      ],
    },
    { type: 'text', text: '这是最终搜索摘要。' },
  ],
});
check(parsed.answer === '这是最终搜索摘要。', '应采用最后一个非空文本块作为搜索摘要');
check(parsed.sources.length === 1 && parsed.sources[0].url === 'https://example.com/doc',
  '来源应移除 fragment、过滤危险协议并按 URL 去重');
check(parsed.sources[0].position === 0 && parsed.searchRequests === 2,
  '来源顺序和服务端搜索次数应被解析');

async function main() {
  let capturedUrl = '';
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody = '';
  const execution = await executeDeepSeekWebSearch({
    call: { id: 'web-1', name: 'web_search', argumentsJson: '{"query":"Muse 是什么"}' },
    settings: ready.settings,
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init?.headers;
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({
        usage: { server_tool_use: { web_search_requests: 1 } },
        content: [
          { type: 'web_search_tool_result', content: [
            { type: 'web_search_result', title: 'Muse', url: 'https://example.com/muse', encrypted_content: 'cipher' },
          ] },
          { type: 'text', text: 'Muse 是一个多义词。' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  check(capturedUrl.endsWith('/anthropic/v1/messages'), '搜索执行器必须调用 DeepSeek Anthropic Messages 接口');
  check(JSON.stringify(capturedHeaders).includes('secret') && !capturedBody.includes('secret'),
    'DeepSeek Key 只能进入请求头，不能进入 body');
  check(capturedBody.includes('web_search_20250305') && !capturedBody.includes('max_uses'),
    '应使用 DeepSeek 服务端搜索且不设置搜索次数上限');
  check(execution.sources.length === 1 && execution.result.answer === 'Muse 是一个多义词。',
    '搜索执行结果应同时交付摘要和来源');

  const bodies: any[] = [];
  let providerCalls = 0;
  const providerResult = await requestAssistantTurn({
    settings: {
      llmEnabled: true,
      llmBaseUrl: 'https://example.test/v1',
      llmKey: 'provider-secret',
      llmModel: 'fixture-model',
      webSearchEnabled: true,
    },
    context: { contextBlock: '上下文', recentMessages: [] },
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      providerCalls += 1;
      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: {
            content: '',
            reasoning_content: '需要联网确认',
            tool_calls: [{
              id: 'web-call', type: 'function',
              function: { name: 'web_search', arguments: '{"query":"Muse 是什么"}' },
            }],
          }, finish_reason: 'tool_calls' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"Muse 是一个多义词。","segment":{"action":"continue"}}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    executeReadTool: async call => ({
      toolCallId: call.id,
      name: 'search_events',
      result: {},
      readEventIds: [], readTodoIds: [], readMemoryIds: [],
    }),
    executeWebSearch: async call => ({
      toolCallId: call.id,
      name: 'web_search',
      result: execution.result,
      sources: execution.sources,
    }),
  });
  check(bodies[0].tools.length === 10, '开启联网后应在九个本地只读工具之外增加 web_search');
  check(providerResult.webSearchUsed && providerResult.webSources.length === 1,
    'Provider 必须把联网使用状态和来源返回编排层');
  check(bodies[1].messages.at(-1).role === 'tool'
    && bodies[1].messages.at(-1).content.includes('Muse 是一个多义词'),
  '搜索摘要必须作为真实工具结果交回主模型');

  let autonomousSearchRounds = 0;
  let autonomousExecutions = 0;
  const autonomousResult = await requestAssistantTurn({
    settings: ready.settings,
    context: { contextBlock: '上下文', recentMessages: [] },
    fetchImpl: async () => {
      autonomousSearchRounds += 1;
      if (autonomousSearchRounds <= 7) {
        return new Response(JSON.stringify({ choices: [{ message: {
          content: '', reasoning_content: '继续核实',
          tool_calls: [{
            id: `web-auto-${autonomousSearchRounds}`, type: 'function',
            function: { name: 'web_search', arguments: `{"query":"第 ${autonomousSearchRounds} 轮"}` },
          }],
        }, finish_reason: 'tool_calls' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"reply":"核实完成。","segment":{"action":"continue"}}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    executeWebSearch: async call => {
      autonomousExecutions += 1;
      return { toolCallId: call.id, name: 'web_search', result: { answer: '结果' }, sources: [] };
    },
  });
  check(autonomousExecutions === 7,
    '小知不得用本地读取轮次预算限制 DeepSeek 自主决定的网页搜索次数');
  check(!autonomousResult.providerMetadata.protocolWarnings.includes('tool_budget_exhausted'),
    '纯网页搜索轮不应触发本地数据工具额度警告');

  const controller = new AbortController();
  controller.abort();
  let cancelled = false;
  try {
    await executeDeepSeekWebSearch({
      call: { id: 'web-stop', name: 'web_search', argumentsJson: '{"query":"停止"}' },
      settings: ready.settings,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        throw new Error('should abort');
      },
    });
  } catch (error: any) {
    cancelled = error?.code === 'cancelled';
  }
  check(cancelled, '用户停止时联网子请求必须按 cancelled 结束');

  console.log('assistant web search tests passed');
}

void main();
