import type { Settings } from '../types';
import type { ContextMessage } from './context';
import { buildAssistantPromptMessages } from './prompt';
import { parseAssistantTurnOutput, type AssistantTurnOutput } from './protocol';

export type AssistantProviderErrorCode = 'missing-key' | 'timeout' | 'network' | 'provider' | 'invalid-response';

export class AssistantProviderError extends Error {
  constructor(public readonly code: AssistantProviderErrorCode, message: string) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

export async function requestAssistantTurn(input: {
  settings: Settings;
  context: { contextBlock: string; recentMessages: ContextMessage[] };
  referenceAt?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AssistantTurnOutput> {
  if (!input.settings.llmEnabled || !input.settings.llmKey) {
    throw new AssistantProviderError('missing-key', '理解引擎尚未开启或未配置 API Key');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);

  let response: Response;
  try {
    response = await fetchImpl(`${input.settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.settings.llmKey}`,
      },
      body: JSON.stringify({
        model: input.settings.llmModel,
        messages: buildAssistantPromptMessages({
          contextBlock: input.context.contextBlock,
          recentMessages: input.context.recentMessages,
          referenceAt: input.referenceAt,
        }),
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (timedOut) throw new AssistantProviderError('timeout', '回复超时，请稍后重试');
    if (input.signal?.aborted) throw new AssistantProviderError('network', '请求已取消');
    throw new AssistantProviderError('network', `网络请求失败：${error?.message ?? '未知错误'}`);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AssistantProviderError('provider', `理解引擎返回错误 ${response.status}: ${detail.slice(0, 160)}`);
  }
  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AssistantProviderError('invalid-response', '理解引擎没有返回有效回复');
  }
  try {
    return parseAssistantTurnOutput(content);
  } catch (error) {
    throw new AssistantProviderError(
      'invalid-response',
      error instanceof Error ? error.message : '理解引擎返回格式异常',
    );
  }
}
