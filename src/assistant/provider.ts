import type { Settings } from '../types';
import type { ContextMessage } from './context';
import { ASSISTANT_OPERATION_FORMAT_GUIDE, buildAssistantPromptMessages } from './prompt';
import {
  AssistantProtocolError,
  inspectAssistantReplyWarnings,
  parseAssistantTurnOutput,
  type AssistantProtocolWarning,
  type AssistantTurnOutput,
} from './protocol';
import { extractPartialJsonStringField } from './streaming-json';

export type AssistantProviderErrorCode = 'missing-key' | 'timeout' | 'network' | 'provider' | 'invalid-response';

export type AssistantRepairStatus = 'not_needed' | 'succeeded' | 'failed';

export interface AssistantProviderDiagnostics {
  repairCount: number;
  repairStatus: AssistantRepairStatus;
  protocolWarnings: AssistantProtocolWarning[];
}

export class AssistantProviderError extends Error {
  constructor(
    public readonly code: AssistantProviderErrorCode,
    message: string,
    public readonly diagnostics: AssistantProviderDiagnostics = {
      repairCount: 0,
      repairStatus: 'not_needed',
      protocolWarnings: [],
    },
  ) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

export interface AssistantProviderMetadata extends AssistantProviderDiagnostics {
  startedAt: number;
  completedAt: number;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type AssistantProviderResult = AssistantTurnOutput & { providerMetadata: AssistantProviderMetadata };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type CompletionResponse = {
  content: string;
  finishReason: string | null;
  usage: any | null;
};

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

async function readCompletionResponse(
  response: Response,
  onReplyText?: (text: string) => void,
): Promise<CompletionResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) return readEventStream(response, onReplyText);
  const data = await response.json().catch(() => null);
  return {
    content: data?.choices?.[0]?.message?.content,
    finishReason: typeof data?.choices?.[0]?.finish_reason === 'string'
      ? data.choices[0].finish_reason
      : null,
    usage: data?.usage ?? null,
  };
}

function usageValue(usage: any, key: string): number | null {
  return Number.isFinite(usage?.[key]) ? Number(usage[key]) : null;
}

function addUsage(left: any | null, right: any | null): any | null {
  if (!left && !right) return null;
  const result: Record<string, number> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const values = [usageValue(left, key), usageValue(right, key)].filter((value): value is number => value !== null);
    if (values.length) result[key] = values.reduce((sum, value) => sum + value, 0);
  }
  return result;
}

function repairPrompt(input: {
  content: string;
  reason: string;
  referenceAt: number;
  timeZone: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '你只负责修复一份 JSON 响应的结构，不重新回答用户，也不改变原有事实、判断、日期、对象 ID 或操作意图。',
        `参考时间：${new Date(input.referenceAt).toLocaleString('zh-CN', { timeZone: input.timeZone })}；时区：${input.timeZone}。`,
        '严格只输出一个 JSON 对象，顶层必须包含 reply、segment、operations。',
        'segment.action 只能是 continue 或 split_before_user。operations 最多6个。',
        ...ASSISTANT_OPERATION_FORMAT_GUIDE,
        '已有对象只能沿用响应里已经出现的候选 ID；不要发明新事实。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `协议错误：${input.reason}\n\n待修复响应：\n${input.content.slice(0, 16_000)}`,
    },
  ];
}

async function requestRepair(input: {
  settings: Settings;
  content: string;
  reason: string;
  referenceAt: number;
  timeZone: string;
  signal: AbortSignal;
  fetchImpl: FetchLike;
}): Promise<CompletionResponse> {
  const response = await input.fetchImpl(`${input.settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.settings.llmKey}`,
    },
    body: JSON.stringify({
      model: input.settings.llmModel,
      messages: repairPrompt(input),
      temperature: 0,
      response_format: { type: 'json_object' },
      stream: false,
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AssistantProviderError('provider', `格式修复返回错误 ${response.status}: ${detail.slice(0, 160)}`);
  }
  return readCompletionResponse(response);
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

    const initial = await readCompletionResponse(response, input.onReplyText);
    let { content, finishReason, usage } = initial;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AssistantProviderError('invalid-response', '理解引擎没有返回有效回复');
    }
    try {
      let repairCount = 0;
      let repairStatus: AssistantRepairStatus = 'not_needed';
      let output: AssistantTurnOutput;
      try {
        output = parseAssistantTurnOutput(content);
      } catch (error) {
        if (!(error instanceof AssistantProtocolError)) throw error;
        const initialWarnings = inspectAssistantReplyWarnings(extractPartialJsonStringField(content, 'reply'));
        repairCount = 1;
        repairStatus = 'failed';
        try {
          const repaired = await requestRepair({
            settings: input.settings,
            content,
            reason: error.message,
            referenceAt: input.referenceAt ?? startedAt,
            timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
            signal: controller.signal,
            fetchImpl,
          });
          if (typeof repaired.content !== 'string' || !repaired.content.trim()) {
            throw new AssistantProviderError('invalid-response', '格式修复没有返回有效回复');
          }
          content = repaired.content;
          finishReason = repaired.finishReason ?? finishReason;
          usage = addUsage(usage, repaired.usage);
          output = parseAssistantTurnOutput(content);
          repairStatus = 'succeeded';
        } catch (repairError) {
          if (controller.signal.aborted) {
            throw new AssistantProviderError(
              timedOut ? 'timeout' : 'network',
              timedOut ? '回复超时，请稍后重试' : '请求已取消',
              { repairCount, repairStatus, protocolWarnings: initialWarnings },
            );
          }
          const repairMessage = repairError instanceof Error ? repairError.message : '未知修复错误';
          throw new AssistantProviderError(
            'invalid-response',
            `${error.message}；自动修复失败：${repairMessage}`,
            { repairCount, repairStatus, protocolWarnings: initialWarnings },
          );
        }
      }
      const protocolWarnings = inspectAssistantReplyWarnings(output.reply);
      input.onReplyText?.(output.reply);
      return {
        ...output,
        providerMetadata: {
          startedAt,
          completedAt: Date.now(),
          finishReason,
          promptTokens: usageValue(usage, 'prompt_tokens'),
          completionTokens: usageValue(usage, 'completion_tokens'),
          totalTokens: usageValue(usage, 'total_tokens'),
          repairCount,
          repairStatus,
          protocolWarnings,
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
