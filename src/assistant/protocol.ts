import type { AssistantSegmentDecision } from './types';
import type {
  AssistantDateProposal,
  AssistantObjectRef,
  AssistantOperationProposal,
} from './action-types';
import type {
  AssistantEventDelta,
  AssistantEventDeltaChangeType,
  AssistantEventDeltaState,
  AssistantEventDeltaTarget,
  AssistantEventDeltaTodoMutation,
} from './event-delta-types';
import type {
  AssistantMemoryCategory,
  AssistantMemoryDeltaProposal,
  AssistantMemorySensitivity,
} from './memory-types';
import { normalizeMultilineText } from './text-normalization';

export interface AssistantTurnOutput {
  reply: string;
  segment: AssistantSegmentDecision;
  operations: AssistantOperationProposal[];
  eventDeltas: AssistantEventDelta[];
  memoryDeltas: AssistantMemoryDeltaProposal[];
  /** 解析层降级剔除的记忆增量；模型格式瑕疵不再炸掉整轮。 */
  memoryRejections: Array<{ key: string; action: string; reason: string }>;
  /**
   * 解析层截断详情（超限取前 N 条继续，不惩罚用户）。
   * dropped 计数进执行回执，模型在最终回复中告知用户剩余部分如何补做。
   */
  truncations: {
    operations: number;
    eventDeltas: number;
    memoryDeltas: number;
    todos: Array<{ deltaKey: string; dropped: number }>;
    progress: Array<{ deltaKey: string; dropped: number }>;
  };
}

export class AssistantProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantProtocolError';
  }
}

export type AssistantProtocolWarning = 'reply_execution_claim' | 'tool_budget_exhausted' | 'empty_content_retried' | 'operations_truncated' | 'event_deltas_truncated' | 'todos_truncated' | 'progress_truncated' | 'memory_deltas_truncated';

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

export function inspectAssistantReplyWarnings(reply: string): AssistantProtocolWarning[] {
  const claim = /我(?:已经|已|刚刚)?(?:替你|帮你|为你)?(?:把[^，。！？]{0,30})?(?:记下|记录|保存|创建|新建|更新|修改|完成|置顶|关联|删除)(?:了|好|完成)|(?:已经|已)(?:帮你|为你|替你)(?:把[^，。！？]{0,30})?(?:记下|记录|保存|创建|新建|更新|修改|完成|置顶|关联|删除)|(?:待办|事件)(?:已经|已)(?:创建|保存|更新|完成|删除)|(?:^|[，。！？；])(?:好的?[，,]?)?(?:已经|已)?(?:帮你|替你|为你)?(?:记下|记录|保存|创建|新建|更新|修改|完成|置顶|关联|删除)(?:了|好|完成)/;
  return claim.test(reply) ? ['reply_execution_claim'] : [];
}

function requiredText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssistantProtocolError(`模型返回缺少 ${field}`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > limit) throw new AssistantProtocolError(`${field} 超过长度限制`);
  return normalized;
}

function requiredMultilineText(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AssistantProtocolError(`模型返回缺少 ${field}`);
  }
  const normalized = normalizeMultilineText(value);
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
const CHANGE_TYPES = new Set<AssistantEventDeltaChangeType>([
  'fact', 'decision', 'result', 'blocker', 'plan', 'correction',
]);
const MEMORY_CATEGORIES = new Set<AssistantMemoryCategory>([
  'preference', 'principle', 'long_term_goal', 'important_relationship', 'recurring_pattern',
]);
const MEMORY_SENSITIVITIES = new Set<AssistantMemorySensitivity>(['ordinary', 'sensitive']);

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

function parseDateProposal(raw: any, required: boolean): AssistantDateProposal | undefined {
  if (raw.date_status === undefined && !required) return undefined;
  const status = requiredText(raw.date_status, 'todo.date_status', 16);
  if (status === 'absent') {
    if (raw.date_text || raw.due_date || raw.due_time || raw.time_precision) {
      throw new AssistantProtocolError('date_status=absent 时不能提供日期字段');
    }
    return { dateStatus: status };
  }
  if (status === 'ambiguous') {
    const dateText = requiredText(raw.date_text, 'todo.date_text', 80);
    if (raw.due_date || raw.due_time || raw.time_precision) {
      throw new AssistantProtocolError('date_status=ambiguous 时不能提供解析后日期');
    }
    return { dateStatus: status, dateText };
  }
  if (status !== 'resolved') throw new AssistantProtocolError('todo.date_status 非法');
  const dateText = requiredText(raw.date_text, 'todo.date_text', 80);
  const dueDate = requiredText(raw.due_date, 'todo.due_date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new AssistantProtocolError('todo.due_date 格式非法');
  const timePrecision = requiredText(raw.time_precision, 'todo.time_precision', 16);
  if (timePrecision !== 'date' && timePrecision !== 'dateTime') {
    throw new AssistantProtocolError('todo.time_precision 非法');
  }
  const dueTime = optionalText(raw.due_time, 'todo.due_time', 5);
  if (timePrecision === 'dateTime') {
    if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) throw new AssistantProtocolError('dateTime 必须提供 HH:mm');
  } else if (dueTime) {
    throw new AssistantProtocolError('仅日期待办不能提供 due_time');
  }
  return { dateStatus: status, dateText, dueDate, dueTime, timePrecision };
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
        ...parseDateProposal(raw, true)!,
      };
    case 'update_todo': {
      const text = optionalText(raw.text, 'todo.text', 240);
      const date = parseDateProposal(raw, false);
      if (!text && !date) throw new AssistantProtocolError('更新待办至少需要内容或日期');
      return {
        key,
        type: raw.type,
        todoId: identifier(raw.todo_id, 'todo_id'),
        text,
        ...date,
      };
    }
    case 'complete_todo':
      return { key, type: raw.type, todoId: identifier(raw.todo_id, 'todo_id') };
    case 'delete_todo':
      return { key, type: raw.type, todoId: identifier(raw.todo_id, 'todo_id') };
    case 'create_event':
      return {
        key,
        type: raw.type,
        eventRef: localRef(raw.event_ref, 'event_ref', EVENT_REF),
        title: requiredText(raw.title, 'event.title', 120),
        currentState: requiredMultilineText(raw.current_state, 'event.current_state', 600),
      };
    case 'update_event':
      return {
        key,
        type: raw.type,
        eventId: identifier(raw.event_id, 'event_id'),
        currentState: requiredMultilineText(raw.current_state, 'event.current_state', 600),
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
    case 'delete_event': {
      const linkedTodoPolicy = requiredText(raw.linked_todo_policy, 'linked_todo_policy', 16);
      if (linkedTodoPolicy !== 'keep' && linkedTodoPolicy !== 'delete') {
        throw new AssistantProtocolError('linked_todo_policy 非法');
      }
      return {
        key,
        type: raw.type,
        eventId: identifier(raw.event_id, 'event_id'),
        linkedTodoPolicy,
      };
    }
    case 'link_todo_event':
    case 'unlink_todo_event':
      return {
        key,
        type: raw.type,
        todo: objectRef(raw, 'todo'),
        event: objectRef(raw, 'event'),
      };
    case 'delete_event_update':
      return {
        key,
        type: raw.type,
        updateId: identifier(raw.update_id, 'update_id'),
        eventId: identifier(raw.event_id, 'event_id'),
      };
    default:
      throw new AssistantProtocolError('模型返回了未知候选操作');
  }
}

const MAX_OPERATIONS = 10;
const MAX_EVENT_DELTAS = 4;
const MAX_MEMORY_DELTAS = 2;
const MAX_DELTA_PROGRESS = 10;
const MAX_DELTA_TODOS = 10;

function parseOperations(value: unknown): { operations: AssistantOperationProposal[]; dropped: number } {
  if (value === undefined) return { operations: [], dropped: 0 };
  if (!Array.isArray(value)) throw new AssistantProtocolError('operations 必须是数组');
  // 超限截断取前 N 条：数量超限是模型话多，不惩罚用户；截断数进回执告知如何补做。
  const bounded = value.slice(0, MAX_OPERATIONS);
  const operations = bounded.map((operation, index) => {
    try {
      return parseOperation(operation);
    } catch (error) {
      if (error instanceof AssistantProtocolError) {
        throw new AssistantProtocolError(`operations[${index}]: ${error.message}`);
      }
      throw error;
    }
  });
  const keys = new Set(operations.map(operation => operation.key));
  if (keys.size !== operations.length) throw new AssistantProtocolError('单轮候选操作键不能重复');
  return { operations, dropped: value.length - bounded.length };
}

function parseChangeType(value: unknown, field: string): AssistantEventDeltaChangeType {
  const parsed = requiredText(value, field, 20) as AssistantEventDeltaChangeType;
  if (!CHANGE_TYPES.has(parsed)) throw new AssistantProtocolError(`${field} 非法`);
  return parsed;
}

function parseEventDeltaTarget(value: unknown): AssistantEventDeltaTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantProtocolError('event_delta.target 必须是对象');
  }
  const raw = value as any;
  const action = requiredText(raw.action, 'event_delta.target.action', 24);
  if (action === 'update_existing') {
    return { action, eventId: identifier(raw.event_id, 'event_delta.target.event_id') };
  }
  if (action === 'create_new') {
    return {
      action,
      eventRef: localRef(raw.event_ref, 'event_delta.target.event_ref', EVENT_REF),
      title: requiredText(raw.title, 'event_delta.target.title', 120),
    };
  }
  if (action === 'none' || action === 'clarify') {
    if (raw.event_id !== undefined || raw.event_ref !== undefined || raw.title !== undefined) {
      throw new AssistantProtocolError(`${action} 目标不能提供事件字段`);
    }
    return { action };
  }
  throw new AssistantProtocolError('event_delta.target.action 非法');
}

function parseEventDeltaState(value: unknown): AssistantEventDeltaState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantProtocolError('event_delta.state 必须是对象');
  }
  const raw = value as any;
  const action = requiredText(raw.action, 'event_delta.state.action', 16);
  if (action === 'keep') {
    if (raw.value !== undefined || raw.change_type !== undefined) {
      throw new AssistantProtocolError('state.action=keep 时不能提供变化字段');
    }
    return { action };
  }
  if (action === 'replace') {
    return {
      action,
      changeType: parseChangeType(raw.change_type, 'event_delta.state.change_type'),
      value: requiredMultilineText(raw.value, 'event_delta.state.value', 600),
    };
  }
  throw new AssistantProtocolError('event_delta.state.action 非法');
}

function parseEventDeltaTodo(value: unknown): AssistantEventDeltaTodoMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantProtocolError('event_delta.todo 必须是对象');
  }
  const raw = value as any;
  const action = requiredText(raw.action, 'event_delta.todo.action', 16);
  if (action === 'create') {
    return {
      action,
      todoRef: localRef(raw.todo_ref, 'event_delta.todo.todo_ref', TODO_REF),
      text: requiredText(raw.text, 'event_delta.todo.text', 240),
      ...parseDateProposal(raw, true)!,
    };
  }
  if (action === 'update') {
    const text = optionalText(raw.text, 'event_delta.todo.text', 240);
    const date = parseDateProposal(raw, false);
    if (!text && !date) throw new AssistantProtocolError('事件增量更新待办至少需要内容或日期');
    return {
      action,
      todoId: identifier(raw.todo_id, 'event_delta.todo.todo_id'),
      text,
      ...date,
    };
  }
  if (action === 'complete') {
    return { action, todoId: identifier(raw.todo_id, 'event_delta.todo.todo_id') };
  }
  throw new AssistantProtocolError('event_delta.todo.action 非法');
}

function parseEventDeltas(value: unknown): {
  deltas: AssistantEventDelta[];
  dropped: number;
  todosTruncations: Array<{ deltaKey: string; dropped: number }>;
  progressTruncations: Array<{ deltaKey: string; dropped: number }>;
} {
  if (value === undefined) return { deltas: [], dropped: 0, todosTruncations: [], progressTruncations: [] };
  if (!Array.isArray(value)) throw new AssistantProtocolError('event_deltas 必须是数组');
  // 超限截断取前 N 条：合并等多主线场景不再被硬上限拒掉整轮。
  const bounded = value.slice(0, MAX_EVENT_DELTAS);
  const todosTruncations: Array<{ deltaKey: string; dropped: number }> = [];
  const progressTruncations: Array<{ deltaKey: string; dropped: number }> = [];
  const deltas = bounded.map((candidate, index) => {
    try {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new AssistantProtocolError('事件增量必须是对象');
      }
      const raw = candidate as any;
      // This key is transport metadata, not a semantic model decision. Generate it
      // locally so a valid turn cannot fail because the model omitted or duplicated
      // an internal idempotency field.
      const key = `event_delta_${index + 1}`;
      if (!Array.isArray(raw.evidence) || raw.evidence.length < 1 || raw.evidence.length > 3) {
        throw new AssistantProtocolError('event_delta.evidence 必须包含 1–3 条本轮原话');
      }
      const evidence = raw.evidence.map((item: unknown) => requiredText(item, 'event_delta.evidence', 160));
      const target = parseEventDeltaTarget(raw.target);
      const state = parseEventDeltaState(raw.state);
      if (!Array.isArray(raw.progress)) {
        throw new AssistantProtocolError('event_delta.progress 必须是数组');
      }
      const boundedProgress = raw.progress.slice(0, MAX_DELTA_PROGRESS);
      if (raw.progress.length > boundedProgress.length) {
        progressTruncations.push({ deltaKey: `event_delta_${index + 1}`, dropped: raw.progress.length - boundedProgress.length });
      }
      const progress = boundedProgress.map((item: any) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new AssistantProtocolError('event_delta.progress 项必须是对象');
        }
        return {
          type: parseChangeType(item.type, 'event_delta.progress.type'),
          content: requiredText(item.content, 'event_delta.progress.content', 800),
        };
      });
      if (!Array.isArray(raw.todos)) {
        throw new AssistantProtocolError('event_delta.todos 必须是数组');
      }
      const boundedTodos = raw.todos.slice(0, MAX_DELTA_TODOS);
      if (raw.todos.length > boundedTodos.length) {
        todosTruncations.push({ deltaKey: `event_delta_${index + 1}`, dropped: raw.todos.length - boundedTodos.length });
      }
      const todos = boundedTodos.map(parseEventDeltaTodo);
      if ((target.action === 'none' || target.action === 'clarify')
        && (state.action !== 'keep' || progress.length > 0 || todos.length > 0)) {
        throw new AssistantProtocolError(`${target.action} 事件增量不能携带数据变化`);
      }
      if (target.action === 'create_new' && state.action !== 'replace') {
        throw new AssistantProtocolError('新事件必须提供完整当前状态');
      }
      return { key, target, evidence, state, progress, todos };
    } catch (error) {
      if (error instanceof AssistantProtocolError) {
        throw new AssistantProtocolError(`event_deltas[${index}]: ${error.message}`);
      }
      throw error;
    }
  });
  return { deltas, dropped: value.length - bounded.length, todosTruncations, progressTruncations };
}

function parseMemoryDeltas(value: unknown): {
  memoryDeltas: AssistantMemoryDeltaProposal[];
  memoryRejections: Array<{ key: string; action: string; reason: string }>;
  dropped: number;
} {
  if (value === undefined) return { memoryDeltas: [], memoryRejections: [], dropped: 0 };
  if (!Array.isArray(value)) throw new AssistantProtocolError('memory_deltas 必须是数组');
  // 记忆准入规则本身谨慎，上限保持 2；超限截断而非整轮失败。
  const bounded = value.slice(0, MAX_MEMORY_DELTAS);
  const memoryDeltas: AssistantMemoryDeltaProposal[] = [];
  const memoryRejections: Array<{ key: string; action: string; reason: string }> = [];
  bounded.forEach((candidate, index) => {
    const key = `memory_delta_${index + 1}`;
    // forget 缺 evidence 时降级为单项拒绝：删除指令的格式瑕疵不应让整轮报废。
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as any).action === 'forget_memory'
      && typeof (candidate as any).evidence !== 'string') {
      memoryRejections.push({ key, action: 'forget_memory', reason: 'missing_evidence' });
      return;
    }
    try {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new AssistantProtocolError('记忆增量必须是对象');
      }
      const raw = candidate as any;
      const action = requiredText(raw.action, 'memory_delta.action', 32);
      const evidence = requiredText(raw.evidence, 'memory_delta.evidence', 200);
      if (action === 'create_candidate' || action === 'create_active') {
        const category = requiredText(raw.category, 'memory_delta.category', 32) as AssistantMemoryCategory;
        const sensitivity = requiredText(raw.sensitivity, 'memory_delta.sensitivity', 16) as AssistantMemorySensitivity;
        if (!MEMORY_CATEGORIES.has(category)) throw new AssistantProtocolError('memory_delta.category 非法');
        if (!MEMORY_SENSITIVITIES.has(sensitivity)) throw new AssistantProtocolError('memory_delta.sensitivity 非法');
        const admissionBasis = requiredText(raw.admission_basis, 'memory_delta.admission_basis', 16);
        const content = requiredText(raw.content, 'memory_delta.content', 200);
        if (action === 'create_active') {
          if (admissionBasis !== 'explicit') throw new AssistantProtocolError('create_active 的准入依据非法');
          memoryDeltas.push({ key, action, category, content, sensitivity, admissionBasis: 'explicit', evidence });
          return;
        }
        if (admissionBasis !== 'inferred') throw new AssistantProtocolError('create_candidate 的准入依据非法');
        memoryDeltas.push({ key, action, category, content, sensitivity, admissionBasis: 'inferred', evidence });
        return;
      }
      const memoryId = identifier(raw.memory_id, 'memory_delta.memory_id');
      const expectedRevision = raw.expected_revision;
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new AssistantProtocolError('memory_delta.expected_revision 非法');
      }
      if (action === 'activate_candidate') {
        const admissionBasis = requiredText(raw.admission_basis, 'memory_delta.admission_basis', 16);
        if (admissionBasis !== 'repeated' && admissionBasis !== 'confirmed') {
          throw new AssistantProtocolError('activate_candidate 的准入依据非法');
        }
        memoryDeltas.push({ key, action, memoryId, expectedRevision, admissionBasis, evidence });
        return;
      }
      if (action === 'supersede_memory') {
        const category = requiredText(raw.category, 'memory_delta.category', 32) as AssistantMemoryCategory;
        const sensitivity = requiredText(raw.sensitivity, 'memory_delta.sensitivity', 16) as AssistantMemorySensitivity;
        if (!MEMORY_CATEGORIES.has(category)) throw new AssistantProtocolError('memory_delta.category 非法');
        if (!MEMORY_SENSITIVITIES.has(sensitivity)) throw new AssistantProtocolError('memory_delta.sensitivity 非法');
        memoryDeltas.push({
          key,
          action,
          memoryId,
          expectedRevision,
          category,
          content: requiredText(raw.content, 'memory_delta.content', 200),
          sensitivity,
          evidence,
        });
        return;
      }
      if (action === 'forget_memory') {
        memoryDeltas.push({ key, action, memoryId, expectedRevision, evidence });
        return;
      }
      throw new AssistantProtocolError('memory_delta.action 非法');
    } catch (error) {
      if (error instanceof AssistantProtocolError) {
        throw new AssistantProtocolError(`memory_deltas[${index}]: ${error.message}`);
      }
      throw error;
    }
  });
  return { memoryDeltas, memoryRejections, dropped: value.length - bounded.length };
}

export function parseAssistantTurnOutput(content: string): AssistantTurnOutput {
  const raw = parseJson(content);
  if (!raw || typeof raw !== 'object') throw new AssistantProtocolError('模型返回缺少对象');
  const reply = typeof raw.reply === 'string' ? raw.reply.trim() : '';
  if (!reply) throw new AssistantProtocolError('模型返回缺少自然回复');
  // segment.action 缺失或非法时降级为 continue：不错误关闭当前分段；
  // 原值进错误信息仅供日志观测（protocol_warnings 不承载，避免噪音）。
  const rawAction = raw.segment?.action;
  const action: 'continue' | 'split_before_user' = rawAction === 'split_before_user' ? 'split_before_user' : 'continue';
  const { operations, dropped: droppedOperations } = parseOperations(raw.operations);
  const { deltas, dropped: droppedEventDeltas, todosTruncations, progressTruncations } = parseEventDeltas(raw.event_deltas);
  const { memoryDeltas, memoryRejections, dropped: droppedMemoryDeltas } = parseMemoryDeltas(raw.memory_deltas);
  return {
    reply,
    segment: {
      action,
      summary: compactSummary(raw.segment?.summary),
      previousSummary: compactSummary(raw.segment?.previous_summary ?? raw.segment?.previousSummary),
    },
    operations,
    eventDeltas: deltas,
    memoryDeltas,
    memoryRejections,
    truncations: {
      operations: droppedOperations,
      eventDeltas: droppedEventDeltas,
      memoryDeltas: droppedMemoryDeltas,
      todos: todosTruncations,
      progress: progressTruncations,
    },
  };
}

/** 把截断详情转成协议警告列表，供决策日志与 provider 元数据记录。 */
export function truncationWarnings(truncations: AssistantTurnOutput['truncations']): AssistantProtocolWarning[] {
  const warnings: AssistantProtocolWarning[] = [];
  if (truncations.operations > 0) warnings.push('operations_truncated');
  if (truncations.eventDeltas > 0) warnings.push('event_deltas_truncated');
  if (truncations.memoryDeltas > 0) warnings.push('memory_deltas_truncated');
  if (truncations.todos.length) warnings.push('todos_truncated');
  if (truncations.progress.length) warnings.push('progress_truncated');
  return warnings;
}
