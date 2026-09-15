import type { AssistantSegmentDecision } from './types';
import type { AssistantObjectRef, AssistantOperationProposal } from './action-types';

export interface AssistantTurnOutput {
  reply: string;
  segment: AssistantSegmentDecision;
  operations: AssistantOperationProposal[];
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

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssistantProtocolError(`模型返回缺少 ${field}`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > limit) throw new AssistantProtocolError(`${field} 超过长度限制`);
  return normalized;
}

function optionalText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, field, limit);
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const OPERATION_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const EVENT_REF = /^event_[1-9][0-9]*$/;
const TODO_REF = /^todo_[1-9][0-9]*$/;

function identifier(value: unknown, field: string): string {
  const parsed = requiredText(value, field, 160);
  if (!IDENTIFIER.test(parsed)) throw new AssistantProtocolError(`${field} 非法`);
  return parsed;
}

function localRef(value: unknown, field: string, pattern: RegExp): string {
  const parsed = requiredText(value, field, 40);
  if (!pattern.test(parsed)) throw new AssistantProtocolError(`${field} 非法`);
  return parsed;
}

function objectRef(raw: any, kind: 'event' | 'todo'): AssistantObjectRef {
  const idField = `${kind}_id`;
  const refField = `${kind}_ref`;
  const hasId = raw[idField] !== undefined;
  const hasRef = raw[refField] !== undefined;
  if (hasId === hasRef) throw new AssistantProtocolError(`${kind} 必须且只能提供候选 ID 或同轮引用`);
  return hasId
    ? { kind: 'candidate', id: identifier(raw[idField], idField) }
    : {
      kind: 'local',
      ref: localRef(raw[refField], refField, kind === 'event' ? EVENT_REF : TODO_REF),
    };
}

function parseOperation(value: unknown): AssistantOperationProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantProtocolError('候选操作必须是对象');
  }
  const raw = value as any;
  const key = requiredText(raw.key, 'operation.key', 64);
  if (!OPERATION_KEY.test(key)) throw new AssistantProtocolError('operation.key 非法');

  switch (raw.type) {
    case 'create_todo':
      return {
        key,
        type: raw.type,
        todoRef: localRef(raw.todo_ref, 'todo_ref', TODO_REF),
        text: requiredText(raw.text, 'todo.text', 240),
        dateText: optionalText(raw.date_text, 'todo.date_text', 80),
      };
    case 'update_todo': {
      const text = optionalText(raw.text, 'todo.text', 240);
      const dateText = optionalText(raw.date_text, 'todo.date_text', 80);
      if (!text && !dateText) throw new AssistantProtocolError('更新待办至少需要内容或日期');
      return {
        key,
        type: raw.type,
        todoId: identifier(raw.todo_id, 'todo_id'),
        text,
        dateText,
      };
    }
    case 'complete_todo':
      return { key, type: raw.type, todoId: identifier(raw.todo_id, 'todo_id') };
    case 'create_event':
      return {
        key,
        type: raw.type,
        eventRef: localRef(raw.event_ref, 'event_ref', EVENT_REF),
        title: requiredText(raw.title, 'event.title', 120),
        currentState: requiredText(raw.current_state, 'event.current_state', 600),
      };
    case 'update_event':
      return {
        key,
        type: raw.type,
        eventId: identifier(raw.event_id, 'event_id'),
        currentState: requiredText(raw.current_state, 'event.current_state', 600),
      };
    case 'append_event_update':
      return {
        key,
        type: raw.type,
        event: objectRef(raw, 'event'),
        content: requiredText(raw.content, 'event_update.content', 800),
      };
    case 'rename_event':
      return {
        key,
        type: raw.type,
        eventId: identifier(raw.event_id, 'event_id'),
        title: requiredText(raw.title, 'event.title', 120),
      };
    case 'pin_event':
      if (typeof raw.pinned !== 'boolean') throw new AssistantProtocolError('pinned 必须是布尔值');
      return {
        key,
        type: raw.type,
        eventId: identifier(raw.event_id, 'event_id'),
        pinned: raw.pinned,
      };
    case 'link_todo_event':
      return {
        key,
        type: raw.type,
        todo: objectRef(raw, 'todo'),
        event: objectRef(raw, 'event'),
      };
    default:
      throw new AssistantProtocolError('模型返回了未知候选操作');
  }
}

function parseOperations(value: unknown): AssistantOperationProposal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AssistantProtocolError('operations 必须是数组');
  if (value.length > 6) throw new AssistantProtocolError('单轮候选操作不能超过 6 个');
  const operations = value.map(parseOperation);
  const keys = new Set(operations.map(operation => operation.key));
  if (keys.size !== operations.length) throw new AssistantProtocolError('单轮候选操作键不能重复');
  return operations;
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
    operations: parseOperations(raw.operations),
  };
}
