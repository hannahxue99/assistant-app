import type { AssistantSegmentDecision } from './types';

export interface AssistantTurnOutput {
  reply: string;
  segment: AssistantSegmentDecision;
}

export class AssistantProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantProtocolError';
  }
}

function parseJson(content: string): any {
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced) throw new AssistantProtocolError('模型返回不是合法 JSON');
    try {
      return JSON.parse(fenced[1]);
    } catch {
      throw new AssistantProtocolError('模型返回不是合法 JSON');
    }
  }
}

function compactSummary(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

export function parseAssistantTurnOutput(content: string): AssistantTurnOutput {
  const raw = parseJson(content);
  if (!raw || typeof raw !== 'object') throw new AssistantProtocolError('模型返回缺少对象');
  const reply = typeof raw.reply === 'string' ? raw.reply.trim() : '';
  if (!reply) throw new AssistantProtocolError('模型返回缺少自然回复');
  const action = raw.segment?.action;
  if (action !== 'continue' && action !== 'split_before_user') {
    throw new AssistantProtocolError('模型返回了非法分段动作');
  }
  return {
    reply,
    segment: {
      action,
      summary: compactSummary(raw.segment?.summary),
      previousSummary: compactSummary(raw.segment?.previous_summary ?? raw.segment?.previousSummary),
    },
  };
}
