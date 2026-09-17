import type { Settings } from '../types';
import type { ContextMessage } from './context';
import { buildAssistantPromptMessages } from './prompt';
import {
  inspectAssistantReplyWarnings,
  parseAssistantTurnOutput,
  type AssistantProtocolWarning,
  type AssistantTurnOutput,
} from './protocol';
import { extractPartialJsonStringField } from './streaming-json';

export type AssistantProviderErrorCode = 'missing-key' | 'timeout' | 'network' | 'provider' | 'invalid-response' | 'cancelled';

export interface AssistantProviderAttempt {
  attempt: number;
  startedAt: number;
  completedAt: number;
  errorCode: AssistantProviderErrorCode | null;
  errorDetail: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AssistantProviderDiagnostics {
  attemptCount: number;
  attempts: AssistantProviderAttempt[];
  protocolWarnings: AssistantProtocolWarning[];
}

export class AssistantProviderError extends Error {
  constructor(
    public readonly code: AssistantProviderErrorCode,
    message: string,
    public readonly diagnostics: AssistantProviderDiagnostics = {
      attemptCount: 0,
      attempts: [],
      protocolWarnings: [],
    },
    public readonly retryable: boolean = code === 'timeout' || code === 'network' || code === 'invalid-response',
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

export type AssistantProviderProgressStage = 'thinking' | 'answering';

export interface AssistantProviderTimeouts {
  firstByteMs: number;
  streamIdleMs: number;
  totalMs: number;
}

export const DEFAULT_ASSISTANT_PROVIDER_TIMEOUTS: AssistantProviderTimeouts = {
  firstByteMs: 45_000,
  streamIdleMs: 30_000,
  totalMs: 180_000,
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type CompletionResponse = {
  content: string;
  finishReason: string | null;
  usage: any | null;
};

async function readEventStream(
  response: Response,
  onReplyText?: (text: string) => void,
  onProgress?: (stage: AssistantProviderProgressStage) => void,
  onActivity?: () => void,
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
    if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content.length > 0) {
      onProgress?.('thinking');
    }
    let receivedContent = false;
    if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0) {
      content += choice.delta.content;
      receivedContent = true;
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (event?.usage && typeof event.usage === 'object') usage = event.usage;
    const partial = extractPartialJsonStringField(content, 'reply');
    const now = Date.now();
    if (partial.length > displayed.length && (lastDisplayAt === 0 || now - lastDisplayAt >= 40)) {
      displayed = partial;
      lastDisplayAt = now;
      onProgress?.('answering');
      onReplyText?.(partial);
    } else if (receivedContent && displayed.length === 0) {
      onProgress?.('thinking');
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.byteLength > 0) onActivity?.();
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
  onProgress?: (stage: AssistantProviderProgressStage) => void,
  onActivity?: () => void,
): Promise<CompletionResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return readEventStream(response, onReplyText, onProgress, onActivity);
  }
  const raw = await response.text();
  onActivity?.();
  const data = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
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

async function requestCompletion(input: {
  settings: Settings;
  body: string;
  callerSignal?: AbortSignal;
  fetchImpl: FetchLike;
  onReplyText?: (text: string) => void;
  onProgress?: (stage: AssistantProviderProgressStage) => void;
  timeouts: AssistantProviderTimeouts;
}): Promise<CompletionResponse> {
  const controller = new AbortController();
  let timeoutReason: 'first-byte' | 'stream-idle' | 'total' | null = null;
  let receivedData = false;
  let firstByteTimeout: ReturnType<typeof setTimeout> | null = null;
  let streamIdleTimeout: ReturnType<typeof setTimeout> | null = null;
  let totalTimeout: ReturnType<typeof setTimeout> | null = null;
  const abortFromCaller = () => controller.abort();
  if (input.callerSignal?.aborted) controller.abort();
  else input.callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const abortForTimeout = (reason: typeof timeoutReason) => {
    if (timeoutReason || input.callerSignal?.aborted) return;
    timeoutReason = reason;
    controller.abort();
  };
  const markActivity = () => {
    if (!receivedData) {
      receivedData = true;
      if (firstByteTimeout) clearTimeout(firstByteTimeout);
      firstByteTimeout = null;
    }
    if (streamIdleTimeout) clearTimeout(streamIdleTimeout);
    streamIdleTimeout = setTimeout(
      () => abortForTimeout('stream-idle'),
      input.timeouts.streamIdleMs,
    );
  };
  firstByteTimeout = setTimeout(
    () => abortForTimeout('first-byte'),
    input.timeouts.firstByteMs,
  );
  totalTimeout = setTimeout(
    () => abortForTimeout('total'),
    input.timeouts.totalMs,
  );
  try {
    const response = await input.fetchImpl(`${input.settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.settings.llmKey}`,
      },
      body: input.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      markActivity();
      const retryable = response.status === 429 || response.status >= 500;
      throw new AssistantProviderError(
        'provider',
        `理解引擎返回错误 ${response.status}: ${detail.slice(0, 160)}`,
        undefined,
        retryable,
      );
    }
    return await readCompletionResponse(
      response,
      input.onReplyText,
      input.onProgress,
      markActivity,
    );
  } catch (error: any) {
    if (error instanceof AssistantProviderError) throw error;
    if (input.callerSignal?.aborted) {
      throw new AssistantProviderError('cancelled', '请求已取消', undefined, false);
    }
    if (timeoutReason === 'first-byte') {
      throw new AssistantProviderError('timeout', '等待回复开始超时，请稍后重试');
    }
    if (timeoutReason === 'stream-idle') {
      throw new AssistantProviderError('timeout', '回复流中断，请稍后重试');
    }
    if (timeoutReason === 'total') {
      throw new AssistantProviderError('timeout', '回复处理超时，请稍后重试');
    }
    throw new AssistantProviderError('network', `网络请求失败：${error?.message ?? '未知错误'}`);
  } finally {
    if (firstByteTimeout) clearTimeout(firstByteTimeout);
    if (streamIdleTimeout) clearTimeout(streamIdleTimeout);
    if (totalTimeout) clearTimeout(totalTimeout);
    input.callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function attemptUsage(attempts: AssistantProviderAttempt[], key: 'promptTokens' | 'completionTokens' | 'totalTokens'): number | null {
  const values = attempts.map(attempt => attempt[key]).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export async function requestAssistantTurn(input: {
  settings: Settings;
  context: { contextBlock: string; recentMessages: ContextMessage[] };
  referenceAt?: number;
  timeZone?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  onReplyText?: (text: string) => void;
  onProgress?: (stage: AssistantProviderProgressStage) => void;
  timeouts?: Partial<AssistantProviderTimeouts>;
}): Promise<AssistantProviderResult> {
  if (!input.settings.llmEnabled || !input.settings.llmKey) {
    throw new AssistantProviderError('missing-key', '理解引擎尚未开启或未配置 API Key');
  }
  const fetchImpl: FetchLike = input.fetchImpl ?? (fetch as FetchLike);
  const startedAt = Date.now();
  const attempts: AssistantProviderAttempt[] = [];
  let protocolWarnings: AssistantProtocolWarning[] = [];
  const timeouts = { ...DEFAULT_ASSISTANT_PROVIDER_TIMEOUTS, ...input.timeouts };
  const requestBody = JSON.stringify({
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
  });

  const attemptStartedAt = Date.now();
  let completion: CompletionResponse | null = null;
  try {
    input.onProgress?.('thinking');
    completion = await requestCompletion({
      settings: input.settings,
      body: requestBody,
      callerSignal: input.signal,
      fetchImpl,
      onReplyText: input.onReplyText,
      onProgress: input.onProgress,
      timeouts,
    });
    if (typeof completion.content !== 'string' || !completion.content.trim()) {
      throw new AssistantProviderError('invalid-response', '理解引擎没有返回有效回复');
    }
    let output: AssistantTurnOutput;
    try {
      output = parseAssistantTurnOutput(completion.content);
    } catch (error) {
      protocolWarnings = inspectAssistantReplyWarnings(extractPartialJsonStringField(completion.content, 'reply'));
      throw new AssistantProviderError(
        'invalid-response',
        error instanceof Error ? error.message : '理解引擎返回格式异常',
      );
    }
    protocolWarnings = inspectAssistantReplyWarnings(output.reply);
    attempts.push({
      attempt: 1,
      startedAt: attemptStartedAt,
      completedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      finishReason: completion.finishReason,
      promptTokens: usageValue(completion.usage, 'prompt_tokens'),
      completionTokens: usageValue(completion.usage, 'completion_tokens'),
      totalTokens: usageValue(completion.usage, 'total_tokens'),
    });
    input.onReplyText?.(output.reply);
    return {
      ...output,
      providerMetadata: {
        startedAt,
        completedAt: Date.now(),
        finishReason: completion.finishReason,
        promptTokens: attemptUsage(attempts, 'promptTokens'),
        completionTokens: attemptUsage(attempts, 'completionTokens'),
        totalTokens: attemptUsage(attempts, 'totalTokens'),
        attemptCount: attempts.length,
        attempts,
        protocolWarnings,
      },
    };
  } catch (error: any) {
    const providerError = error instanceof AssistantProviderError
      ? error
      : new AssistantProviderError(
        'invalid-response',
        error instanceof Error ? error.message : '理解引擎返回格式异常',
      );
    attempts.push({
      attempt: 1,
      startedAt: attemptStartedAt,
      completedAt: Date.now(),
      errorCode: providerError.code,
      errorDetail: providerError.message,
      finishReason: completion?.finishReason ?? null,
      promptTokens: usageValue(completion?.usage, 'prompt_tokens'),
      completionTokens: usageValue(completion?.usage, 'completion_tokens'),
      totalTokens: usageValue(completion?.usage, 'total_tokens'),
    });
    throw new AssistantProviderError(
      providerError.code,
      providerError.message,
      { attemptCount: attempts.length, attempts, protocolWarnings },
      false,
    );
  }
}
