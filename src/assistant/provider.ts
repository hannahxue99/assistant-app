import type { Settings } from '../types';
import type { ContextMessage } from './context';
import { buildAssistantPromptMessages } from './prompt';
import {
  inspectAssistantReplyWarnings,
  parseAssistantTurnOutput,
  truncationWarnings,
  type AssistantProtocolWarning,
  type AssistantTurnOutput,
} from './protocol';
import { extractPartialJsonStringField } from './streaming-json';
import {
  ASSISTANT_READ_TOOLS,
  mergeAssistantReadSets,
  type AssistantReadSet,
  type AssistantReadToolExecution,
} from './data-tools';
import {
  ASSISTANT_WEB_SEARCH_TOOL,
  type AssistantWebSearchExecution,
  type AssistantWebSource,
} from './web-search';

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

export interface AssistantProviderReasoning {
  content: string;
  startedAt: number;
  completedAt: number;
}

export type AssistantProviderResult = AssistantTurnOutput & {
  providerMetadata: AssistantProviderMetadata;
  reasoning: AssistantProviderReasoning | null;
  grounding: AssistantReadSet;
  webSearchUsed: boolean;
  webSources: AssistantWebSource[];
};

export type AssistantProviderProgressStage = 'thinking' | 'reading' | 'searching' | 'answering';

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
  reasoningContent: string;
  reasoningStartedAt: number | null;
  reasoningCompletedAt: number | null;
  finishReason: string | null;
  usage: any | null;
  toolCalls: ProviderToolCall[];
};

export interface ProviderToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

type PendingToolCall = { id: string; name: string; argumentsJson: string };

export function mergeProviderToolCallDelta(
  pending: Map<number, PendingToolCall>,
  deltas: any[],
): void {
  for (const delta of deltas) {
    const index = Number.isInteger(delta?.index) ? Number(delta.index) : 0;
    const current = pending.get(index) ?? { id: '', name: '', argumentsJson: '' };
    if (typeof delta?.id === 'string') current.id += delta.id;
    if (typeof delta?.function?.name === 'string') current.name += delta.function.name;
    if (typeof delta?.function?.arguments === 'string') current.argumentsJson += delta.function.arguments;
    pending.set(index, current);
  }
}

async function readEventStream(
  response: Response,
  onReplyText?: (text: string) => void,
  onReasoningText?: (text: string) => void,
  onProgress?: (stage: AssistantProviderProgressStage) => void,
  onActivity?: () => void,
  contentMode: 'json-reply' | 'raw' = 'json-reply',
): Promise<CompletionResponse> {
  if (!response.body) throw new AssistantProviderError('invalid-response', '理解引擎没有返回流式内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let reasoningContent = '';
  let displayedReasoning = '';
  let displayed = '';
  let lastDisplayAt = 0;
  let lastReasoningDisplayAt = 0;
  let reasoningStartedAt: number | null = null;
  let reasoningCompletedAt: number | null = null;
  let finishReason: string | null = null;
  let usage: any | null = null;
  const pendingToolCalls = new Map<number, PendingToolCall>();

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
    if (Array.isArray(choice?.delta?.tool_calls)) {
      mergeProviderToolCallDelta(pendingToolCalls, choice.delta.tool_calls);
    }
    if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content.length > 0) {
      const now = Date.now();
      reasoningStartedAt ??= now;
      reasoningContent += choice.delta.reasoning_content;
      onProgress?.('thinking');
      if (lastReasoningDisplayAt === 0 || now - lastReasoningDisplayAt >= 80) {
        displayedReasoning = reasoningContent;
        lastReasoningDisplayAt = now;
        onReasoningText?.(reasoningContent);
      }
    }
    let receivedContent = false;
    if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0) {
      content += choice.delta.content;
      receivedContent = true;
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (event?.usage && typeof event.usage === 'object') usage = event.usage;
    const partial = contentMode === 'raw' ? content : extractPartialJsonStringField(content, 'reply');
    const now = Date.now();
    if (partial.length > displayed.length && (lastDisplayAt === 0 || now - lastDisplayAt >= 40)) {
      displayed = partial;
      lastDisplayAt = now;
      reasoningCompletedAt ??= now;
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
  if (reasoningContent && displayedReasoning !== reasoningContent) onReasoningText?.(reasoningContent);
  if (reasoningContent) reasoningCompletedAt ??= Date.now();
  return {
    content,
    reasoningContent,
    reasoningStartedAt,
    reasoningCompletedAt,
    finishReason,
    usage,
    toolCalls: [...pendingToolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
      .filter(call => call.id && call.name),
  };
}

async function readCompletionResponse(
  response: Response,
  onReplyText?: (text: string) => void,
  onReasoningText?: (text: string) => void,
  onProgress?: (stage: AssistantProviderProgressStage) => void,
  onActivity?: () => void,
  contentMode: 'json-reply' | 'raw' = 'json-reply',
): Promise<CompletionResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return readEventStream(response, onReplyText, onReasoningText, onProgress, onActivity, contentMode);
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
  const reasoningContent = typeof data?.choices?.[0]?.message?.reasoning_content === 'string'
    ? data.choices[0].message.reasoning_content
    : '';
  const completedAt = Date.now();
  if (reasoningContent) onReasoningText?.(reasoningContent);
  return {
    content: data?.choices?.[0]?.message?.content,
    reasoningContent,
    reasoningStartedAt: reasoningContent ? completedAt : null,
    reasoningCompletedAt: reasoningContent ? completedAt : null,
    finishReason: typeof data?.choices?.[0]?.finish_reason === 'string'
      ? data.choices[0].finish_reason
      : null,
    usage: data?.usage ?? null,
    toolCalls: Array.isArray(data?.choices?.[0]?.message?.tool_calls)
      ? data.choices[0].message.tool_calls.map((call: any) => ({
        id: String(call?.id ?? ''),
        name: String(call?.function?.name ?? ''),
        argumentsJson: String(call?.function?.arguments ?? '{}'),
      })).filter((call: ProviderToolCall) => call.id && call.name)
      : [],
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
  onReasoningText?: (text: string) => void;
  onProgress?: (stage: AssistantProviderProgressStage) => void;
  timeouts: AssistantProviderTimeouts;
  contentMode?: 'json-reply' | 'raw';
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
      input.onReasoningText,
      input.onProgress,
      markActivity,
      input.contentMode,
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
  onReasoningText?: (text: string) => void;
  onProgress?: (stage: AssistantProviderProgressStage) => void;
  timeouts?: Partial<AssistantProviderTimeouts>;
  executeReadTool?: (call: ProviderToolCall) => Promise<AssistantReadToolExecution>;
  executeWebSearch?: (call: ProviderToolCall) => Promise<AssistantWebSearchExecution>;
}): Promise<AssistantProviderResult> {
  if (!input.settings.llmEnabled || !input.settings.llmKey) {
    throw new AssistantProviderError('missing-key', '理解引擎尚未开启或未配置 API Key');
  }
  const fetchImpl: FetchLike = input.fetchImpl ?? (fetch as FetchLike);
  const startedAt = Date.now();
  const attempts: AssistantProviderAttempt[] = [];
  let protocolWarnings: AssistantProtocolWarning[] = [];
  const timeouts = { ...DEFAULT_ASSISTANT_PROVIDER_TIMEOUTS, ...input.timeouts };
  const messages: any[] = buildAssistantPromptMessages({
      contextBlock: input.context.contextBlock,
      recentMessages: input.context.recentMessages,
      referenceAt: input.referenceAt,
      timeZone: input.timeZone,
  });
  const toolExecutions: AssistantReadToolExecution[] = [];
  const webSearchExecutions: AssistantWebSearchExecution[] = [];
  const maxReadRounds = 6;
  const maxReadToolCalls = 12;
  let readRounds = 0;
  // 只限制本地数据读取；DeepSeek 服务端网页搜索不受小知的次数或结果数预算干预。
  let readToolsDisabled = false;
  // DeepSeek 偶发把全部输出放进 reasoning_content 而 content 为空；追加提示重试一次。
  let emptyContentRetried = false;
  let completion: CompletionResponse | null = null;
  try {
    while (true) {
      const attemptStartedAt = Date.now();
      input.onProgress?.('thinking');
      const tools = [
        ...(input.executeReadTool && !readToolsDisabled ? ASSISTANT_READ_TOOLS : []),
        ...(input.executeWebSearch ? [ASSISTANT_WEB_SEARCH_TOOL] : []),
      ];
      completion = await requestCompletion({
        settings: input.settings,
        body: JSON.stringify({
          model: input.settings.llmModel,
          messages,
          thinking: { type: 'enabled' },
          reasoning_effort: 'high',
          response_format: { type: 'json_object' },
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          stream: true,
          stream_options: { include_usage: true },
        }),
        callerSignal: input.signal,
        fetchImpl,
        onReplyText: input.onReplyText,
        onReasoningText: input.onReasoningText,
        onProgress: input.onProgress,
        timeouts,
      });
      attempts.push({
        attempt: attempts.length + 1,
        startedAt: attemptStartedAt,
        completedAt: Date.now(),
        errorCode: null,
        errorDetail: null,
        finishReason: completion.finishReason,
        promptTokens: usageValue(completion.usage, 'prompt_tokens'),
        completionTokens: usageValue(completion.usage, 'completion_tokens'),
        totalTokens: usageValue(completion.usage, 'total_tokens'),
      });
      if (completion.toolCalls.length === 0) {
        const hasEmptyContent = typeof completion.content !== 'string' || !completion.content.trim();
        if (hasEmptyContent && completion.reasoningContent.trim() && !emptyContentRetried) {
          emptyContentRetried = true;
          protocolWarnings = [...new Set([...protocolWarnings, 'empty_content_retried' as const])];
          messages.push({
            role: 'user',
            content: '请把最终答复直接写进回复正文，不要只放在思考过程里；按既定 JSON 格式输出。',
          });
          continue;
        }
        break;
      }
      const unsupportedCall = completion.toolCalls.find(call => (
        call.name === 'web_search' ? !input.executeWebSearch : !input.executeReadTool
      ));
      if (unsupportedCall) {
        throw new AssistantProviderError('invalid-response', '理解引擎请求了未启用的数据工具');
      }
      const localReadCalls = completion.toolCalls.filter(call => call.name !== 'web_search');
      if (localReadCalls.length > 0) readRounds += 1;
      if (localReadCalls.length > 0
        && (readRounds > maxReadRounds || toolExecutions.length + localReadCalls.length > maxReadToolCalls)) {
        protocolWarnings = [...new Set([...protocolWarnings, 'tool_budget_exhausted' as const])];
        messages.push({
          role: 'assistant',
          content: completion.content || null,
          reasoning_content: completion.reasoningContent || undefined,
          tool_calls: completion.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.argumentsJson },
          })),
        });
        for (const call of completion.toolCalls) {
          if (call.name === 'web_search') {
            input.onProgress?.('searching');
            const searched = await input.executeWebSearch!(call);
            webSearchExecutions.push(searched);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(searched.result),
            });
            continue;
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              error: 'tool_budget_exhausted',
              message: '本轮读取工具额度已用尽，此次调用未执行。',
            }),
          });
        }
        messages.push({
          role: 'system',
          content: '本地数据读取工具额度已用尽。不要再读取本地数据；仍可在确有需要时使用网页搜索，否则请基于已读取的信息输出最终 JSON 计划，并对未核实事项明确说明。',
        });
        readToolsDisabled = true;
        continue;
      }
      messages.push({
        role: 'assistant',
        content: completion.content || null,
        // 实测（deepseek-flash + thinking）：续轮必须回传上一轮 reasoning_content，缺失会被 400 拒绝。
        reasoning_content: completion.reasoningContent || undefined,
        tool_calls: completion.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      });
      for (const call of completion.toolCalls) {
        const execution = call.name === 'web_search'
          ? await (async () => {
            input.onProgress?.('searching');
            const searched = await input.executeWebSearch!(call);
            webSearchExecutions.push(searched);
            return searched;
          })()
          : await (async () => {
            input.onProgress?.('reading');
            const read = await input.executeReadTool!(call);
            toolExecutions.push(read);
            return read;
          })();
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(execution.result),
        });
      }
    }
    if (typeof completion.content !== 'string' || !completion.content.trim()) {
      // 失败时保留思考尾部，便于在决策日志里回溯模型把输出放到了哪里。
      const reasoningTail = completion.reasoningContent.trim().slice(-120);
      throw new AssistantProviderError(
        'invalid-response',
        reasoningTail
          ? `理解引擎没有返回有效回复（模型仅在思考中输出：…${reasoningTail}）`
          : '理解引擎没有返回有效回复',
      );
    }
    let output: AssistantTurnOutput;
    try {
      output = parseAssistantTurnOutput(completion.content);
    } catch (error) {
      protocolWarnings = [...new Set([
        ...protocolWarnings,
        ...inspectAssistantReplyWarnings(extractPartialJsonStringField(completion.content, 'reply')),
      ])];
      throw new AssistantProviderError(
        'invalid-response',
        error instanceof Error ? error.message : '理解引擎返回格式异常',
      );
    }
    protocolWarnings = [...new Set([
      ...protocolWarnings,
      ...inspectAssistantReplyWarnings(output.reply),
      ...truncationWarnings(output.truncations),
    ])];
    input.onReplyText?.(output.reply);
    const webSources = [...new Map(
      webSearchExecutions.flatMap(item => item.sources).map(source => [source.url, source] as const),
    ).values()].map((source, position) => ({ ...source, position }));
    return {
      ...output,
      grounding: mergeAssistantReadSets(toolExecutions),
      webSearchUsed: webSearchExecutions.length > 0,
      webSources,
      reasoning: completion.reasoningContent.trim()
        ? {
          content: completion.reasoningContent,
          startedAt: completion.reasoningStartedAt ?? startedAt,
          completedAt: completion.reasoningCompletedAt ?? completion.reasoningStartedAt ?? Date.now(),
        }
        : null,
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
    const lastAttempt = attempts.at(-1);
    if (lastAttempt?.errorCode === null) {
      attempts[attempts.length - 1] = {
        ...lastAttempt,
        completedAt: Date.now(),
        errorCode: providerError.code,
        errorDetail: providerError.message,
      };
    } else if (!attempts.length) {
      attempts.push({
        attempt: 1,
        startedAt: completion?.reasoningStartedAt ?? startedAt,
        completedAt: Date.now(),
        errorCode: providerError.code,
        errorDetail: providerError.message,
        finishReason: completion?.finishReason ?? null,
        promptTokens: usageValue(completion?.usage, 'prompt_tokens'),
        completionTokens: usageValue(completion?.usage, 'completion_tokens'),
        totalTokens: usageValue(completion?.usage, 'total_tokens'),
      });
    }
    throw new AssistantProviderError(
      providerError.code,
      providerError.message,
      { attemptCount: attempts.length, attempts, protocolWarnings },
      false,
    );
  }
}

export async function requestAssistantFinalReply(input: {
  settings: Settings;
  userMessage: string;
  draftReply: string;
  executionResult: unknown;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  onReplyText?: (text: string) => void;
  onProgress?: (stage: AssistantProviderProgressStage) => void;
  timeouts?: Partial<AssistantProviderTimeouts>;
}): Promise<{ reply: string; providerMetadata: AssistantProviderMetadata }> {
  if (!input.settings.llmEnabled || !input.settings.llmKey) {
    throw new AssistantProviderError('missing-key', '理解引擎尚未开启或未配置 API Key');
  }
  const fetchImpl: FetchLike = input.fetchImpl ?? (fetch as FetchLike);
  const startedAt = Date.now();
  const attemptStartedAt = Date.now();
  const timeouts = { ...DEFAULT_ASSISTANT_PROVIDER_TIMEOUTS, ...input.timeouts };
  let completion: CompletionResponse | null = null;
  try {
    completion = await requestCompletion({
      settings: input.settings,
      body: JSON.stringify({
        model: input.settings.llmModel,
        messages: [
          {
            role: 'system',
            content: [
              '你是小知。请根据本地真实执行回执，给用户一句自然、简洁、连续的最终回复。',
              '只有 execution_result.committed 中的事项可以说“已完成/已更新/已创建”。',
              'rejected 或 failed 必须明确表示没有完成对应修改；no_change 可以沿用草稿对用户问题的回答。',
              '不要提及 JSON、工具、校验器、数据库、模型或内部流程。只输出给用户看的正文。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              user_message: input.userMessage,
              draft_reply: input.draftReply,
              execution_result: input.executionResult,
            }),
          },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        stream: true,
        stream_options: { include_usage: true },
      }),
      callerSignal: input.signal,
      fetchImpl,
      onReplyText: input.onReplyText,
      onProgress: input.onProgress,
      timeouts,
      contentMode: 'raw',
    });
    const reply = completion.content.trim();
    if (!reply) throw new AssistantProviderError('invalid-response', '理解引擎没有返回最终回复');
    input.onReplyText?.(reply);
    const attempt: AssistantProviderAttempt = {
      attempt: 1,
      startedAt: attemptStartedAt,
      completedAt: Date.now(),
      errorCode: null,
      errorDetail: null,
      finishReason: completion.finishReason,
      promptTokens: usageValue(completion.usage, 'prompt_tokens'),
      completionTokens: usageValue(completion.usage, 'completion_tokens'),
      totalTokens: usageValue(completion.usage, 'total_tokens'),
    };
    return {
      reply,
      providerMetadata: {
        startedAt,
        completedAt: Date.now(),
        finishReason: completion.finishReason,
        promptTokens: attempt.promptTokens,
        completionTokens: attempt.completionTokens,
        totalTokens: attempt.totalTokens,
        attemptCount: 1,
        attempts: [attempt],
        protocolWarnings: [],
      },
    };
  } catch (error: any) {
    if (error instanceof AssistantProviderError) throw error;
    throw new AssistantProviderError('invalid-response', error instanceof Error ? error.message : '最终回复生成失败');
  }
}
