import type { Settings } from '../types';
import type { ContextMessage } from './context';
import { buildAssistantPromptMessages } from './prompt';
import { parseAssistantTurnOutput, type AssistantTurnOutput } from './protocol';
import { extractPartialJsonStringField } from './streaming-json';

export type AssistantProviderErrorCode = 'missing-key' | 'timeout' | 'network' | 'provider' | 'invalid-response';

export class AssistantProviderError extends Error {
  constructor(public readonly code: AssistantProviderErrorCode, message: string) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

export interface AssistantProviderMetadata {
  startedAt: number;
  completedAt: number;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type AssistantProviderResult = AssistantTurnOutput & { providerMetadata: AssistantProviderMetadata };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readEventStream(
  response: Response,
  onReplyText?: (text: string) => void,
): Promise<{ content: string; finishReason: string | null; usage: any | null }> {
  if (!response.body) throw new AssistantProviderError('invalid-response', '理解引擎没有返回流式内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let displayed = '';
  let lastDisplayAt = 0;
  let finishReason: string | null = null;
  let usage: any | null = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new AssistantProviderError('invalid-response', '理解引擎返回了损坏的流式数据');
    }
    const choice = event?.choices?.[0];
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (event?.usage && typeof event.usage === 'object') usage = event.usage;
    const partial = extractPartialJsonStringField(content, 'reply');
    const now = Date.now();
    if (partial.length > displayed.length && (lastDisplayAt === 0 || now - lastDisplayAt >= 40)) {
      displayed = partial;
      lastDisplayAt = now;
      onReplyText?.(partial);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  }
  pending += decoder.decode();
  if (pending.trim()) consumeLine(pending);
  return { content, finishReason, usage };
}

export async function requestAssistantTurn(input: {
  settings: Settings;
  context: { contextBlock: string; recentMessages: ContextMessage[] };
  referenceAt?: number;
  timeZone?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  onReplyText?: (text: string) => void;
}): Promise<AssistantProviderResult> {
  if (!input.settings.llmEnabled || !input.settings.llmKey) {
    throw new AssistantProviderError('missing-key', '理解引擎尚未开启或未配置 API Key');
  }
  const fetchImpl: FetchLike = input.fetchImpl ?? (fetch as FetchLike);
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);

  try {
    const response = await fetchImpl(`${input.settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
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
          timeZone: input.timeZone,
        }),
        temperature: 0.4,
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AssistantProviderError('provider', `理解引擎返回错误 ${response.status}: ${detail.slice(0, 160)}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    let content: string;
    let finishReason: string | null = null;
    let usage: any | null = null;
    if (contentType.includes('text/event-stream')) {
      const streamed = await readEventStream(response, input.onReplyText);
      content = streamed.content;
      finishReason = streamed.finishReason;
      usage = streamed.usage;
    } else {
      const data = await response.json().catch(() => null);
      content = data?.choices?.[0]?.message?.content;
      finishReason = typeof data?.choices?.[0]?.finish_reason === 'string' ? data.choices[0].finish_reason : null;
      usage = data?.usage ?? null;
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new AssistantProviderError('invalid-response', '理解引擎没有返回有效回复');
    }
    try {
      const output = parseAssistantTurnOutput(content);
      input.onReplyText?.(output.reply);
      return {
        ...output,
        providerMetadata: {
          startedAt,
          completedAt: Date.now(),
          finishReason,
          promptTokens: Number.isFinite(usage?.prompt_tokens) ? Number(usage.prompt_tokens) : null,
          completionTokens: Number.isFinite(usage?.completion_tokens) ? Number(usage.completion_tokens) : null,
          totalTokens: Number.isFinite(usage?.total_tokens) ? Number(usage.total_tokens) : null,
        },
      };
    } catch (error) {
      if (error instanceof AssistantProviderError) throw error;
      throw new AssistantProviderError(
        'invalid-response',
        error instanceof Error ? error.message : '理解引擎返回格式异常',
      );
    }
  } catch (error: any) {
    if (error instanceof AssistantProviderError) throw error;
    if (timedOut) throw new AssistantProviderError('timeout', '回复超时，请稍后重试');
    if (input.signal?.aborted) throw new AssistantProviderError('network', '请求已取消');
    throw new AssistantProviderError('network', `网络请求失败：${error?.message ?? '未知错误'}`);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortFromCaller);
  }
}
