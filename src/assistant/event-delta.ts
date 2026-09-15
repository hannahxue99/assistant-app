import { validateAssistantActions } from './action-validator';
import type {
  AssistantActionContext,
  AssistantActionRejection,
  AssistantObjectRef,
  AssistantOperationProposal,
  ValidatedAssistantOperation,
} from './action-types';
import type {
  AssistantEventDelta,
  AssistantEventDeltaTodoMutation,
} from './event-delta-types';

export type AssistantEventDeltaRejectionReason =
  | 'evidence_not_in_message'
  | 'inconsistent_delta'
  | 'todo_should_update_existing'
  | 'compiled_operation_rejected';

export interface AssistantEventDeltaRejection {
  key: string;
  type: 'event_delta';
  reason: AssistantEventDeltaRejectionReason;
  detail?: string;
}

export interface PreparedAssistantActions {
  accepted: ValidatedAssistantOperation[];
  rejected: Array<AssistantActionRejection | AssistantEventDeltaRejection>;
  compiled: AssistantOperationProposal[];
}

function normalizedEvidence(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function evidenceBelongsToMessage(evidence: string[], currentMessage: string): boolean {
  const message = normalizedEvidence(currentMessage);
  return Boolean(message) && evidence.every(item => {
    const normalized = normalizedEvidence(item);
    return Boolean(normalized) && message.includes(normalized);
  });
}

function eventRefFor(delta: AssistantEventDelta): AssistantObjectRef | null {
  if (delta.target.action === 'update_existing') {
    return { kind: 'candidate', id: delta.target.eventId };
  }
  if (delta.target.action === 'create_new') {
    return { kind: 'local', ref: delta.target.eventRef };
  }
  return null;
}

function compileTodo(
  todo: AssistantEventDeltaTodoMutation,
  key: string,
): AssistantOperationProposal {
  if (todo.action === 'create') {
    return {
      key,
      type: 'create_todo',
      todoRef: todo.todoRef,
      text: todo.text,
      dateStatus: todo.dateStatus,
      ...('dateText' in todo ? { dateText: todo.dateText } : {}),
      ...('dueDate' in todo ? { dueDate: todo.dueDate } : {}),
      ...('dueTime' in todo && todo.dueTime ? { dueTime: todo.dueTime } : {}),
      ...('timePrecision' in todo && todo.timePrecision ? { timePrecision: todo.timePrecision } : {}),
    } as AssistantOperationProposal;
  }
  if (todo.action === 'update') {
    return {
      key,
      type: 'update_todo',
      todoId: todo.todoId,
      ...(todo.text ? { text: todo.text } : {}),
      ...(todo.dateStatus ? { dateStatus: todo.dateStatus } : {}),
      ...('dateText' in todo && todo.dateText ? { dateText: todo.dateText } : {}),
      ...('dueDate' in todo && todo.dueDate ? { dueDate: todo.dueDate } : {}),
      ...('dueTime' in todo && todo.dueTime ? { dueTime: todo.dueTime } : {}),
      ...('timePrecision' in todo && todo.timePrecision ? { timePrecision: todo.timePrecision } : {}),
    } as AssistantOperationProposal;
  }
  return { key, type: 'complete_todo', todoId: todo.todoId };
}

function compileDelta(delta: AssistantEventDelta, index: number): AssistantOperationProposal[] {
  const prefix = `event-delta-${index + 1}`;
  const event = eventRefFor(delta);
  if (!event) return [];
  const operations: AssistantOperationProposal[] = [];

  if (delta.target.action === 'create_new') {
    if (delta.state.action !== 'replace') return [];
    operations.push({
      key: `${prefix}-event`,
      type: 'create_event',
      eventRef: delta.target.eventRef,
      title: delta.target.title,
      currentState: delta.state.value,
    });
  } else if (delta.target.action === 'update_existing' && delta.state.action === 'replace') {
    operations.push({
      key: `${prefix}-state`,
      type: 'update_event',
      eventId: delta.target.eventId,
      currentState: delta.state.value,
    });
  }

  delta.progress.forEach((progress, progressIndex) => {
    operations.push({
      key: `${prefix}-progress-${progressIndex + 1}`,
      type: 'append_event_update',
      event,
      content: progress.content,
    });
  });

  delta.todos.forEach((todo, todoIndex) => {
    const ordinal = todoIndex + 1;
    operations.push(compileTodo(todo, `${prefix}-todo-${ordinal}`));
    const todoRef: AssistantObjectRef = todo.action === 'create'
      ? { kind: 'local', ref: todo.todoRef }
      : { kind: 'candidate', id: todo.todoId };
    operations.push({
      key: `${prefix}-link-${ordinal}`,
      type: 'link_todo_event',
      todo: todoRef,
      event,
    });
  });
  return operations;
}

function prevalidateDelta(
  delta: AssistantEventDelta,
  currentMessage: string,
  actionContext: AssistantActionContext,
): AssistantEventDeltaRejection | null {
  if (!evidenceBelongsToMessage(delta.evidence, currentMessage)) {
    return { key: delta.key, type: 'event_delta', reason: 'evidence_not_in_message' };
  }
  if (delta.target.action === 'none' || delta.target.action === 'clarify') return null;
  if (delta.state.action === 'replace' && delta.progress.length === 0) {
    return {
      key: delta.key,
      type: 'event_delta',
      reason: 'inconsistent_delta',
      detail: '状态变化必须对应关键进展',
    };
  }
  if (delta.todos.length > 0 && delta.progress.length === 0) {
    return {
      key: delta.key,
      type: 'event_delta',
      reason: 'inconsistent_delta',
      detail: '待办变化必须对应关键进展',
    };
  }
  const targetEventId = delta.target.action === 'update_existing' ? delta.target.eventId : null;
  const targetEvent = targetEventId
    ? actionContext.events.find(event => event.id === targetEventId)
    : null;
  const existingTodos = [
    ...actionContext.todos.map(todo => todo.text),
    ...(targetEvent?.linkedTodos ?? []).filter(todo => !todo.done).map(todo => todo.text),
  ];
  const duplicateCreate = delta.todos.find(todo => todo.action === 'create' && existingTodos.some(text => {
    const incoming = normalizedEvidence(todo.text);
    const existing = normalizedEvidence(text);
    return Boolean(incoming && existing && (
      incoming === existing || incoming.includes(existing) || existing.includes(incoming)
    ));
  }));
  if (duplicateCreate) {
    return {
      key: delta.key,
      type: 'event_delta',
      reason: 'todo_should_update_existing',
      detail: '新建待办与已有候选重复，应更新原待办',
    };
  }
  return null;
}

export function prepareAssistantActions(input: {
  operations: AssistantOperationProposal[];
  eventDeltas: AssistantEventDelta[];
  actionContext: AssistantActionContext;
  currentMessage: string;
  recentEvidence: string[];
  referenceAt: number;
}): PreparedAssistantActions {
  const rejected: Array<AssistantActionRejection | AssistantEventDeltaRejection> = [];
  const eventOperationTypes = new Set([
    'create_event', 'update_event', 'append_event_update', 'link_todo_event',
  ]);
  const compiled: AssistantOperationProposal[] = [];
  for (const operation of input.operations) {
    if (input.eventDeltas.length > 0 && eventOperationTypes.has(operation.type)) {
      rejected.push({ key: operation.key, type: operation.type, reason: 'mixed_event_operations' });
    } else {
      compiled.push(operation);
    }
  }
  const operationDeltaIndex = new Map<string, number>();
  const activeDeltaIndexes = new Set<number>();

  input.eventDeltas.forEach((delta, index) => {
    const rejection = prevalidateDelta(delta, input.currentMessage, input.actionContext);
    if (rejection) {
      rejected.push(rejection);
      return;
    }
    if (delta.target.action === 'none' || delta.target.action === 'clarify') return;
    const operations = compileDelta(delta, index);
    activeDeltaIndexes.add(index);
    for (const operation of operations) {
      operationDeltaIndex.set(operation.key, index);
      compiled.push(operation);
    }
  });

  const validation = validateAssistantActions({
    operations: compiled,
    actionContext: input.actionContext,
    currentMessage: input.currentMessage,
    recentEvidence: input.recentEvidence,
    referenceAt: input.referenceAt,
  });
  rejected.push(...validation.rejected);

  const rejectedDeltaIndexes = new Set<number>();
  for (const operationRejection of validation.rejected) {
    const index = operationDeltaIndex.get(operationRejection.key);
    if (index !== undefined) rejectedDeltaIndexes.add(index);
  }
  for (const index of rejectedDeltaIndexes) {
    const delta = input.eventDeltas[index];
    rejected.push({
      key: delta.key,
      type: 'event_delta',
      reason: 'compiled_operation_rejected',
      detail: validation.rejected
        .filter(item => operationDeltaIndex.get(item.key) === index)
        .map(item => `${item.type}:${item.reason}`)
        .join(','),
    });
  }

  return {
    accepted: validation.accepted.filter(operation => {
      const index = operationDeltaIndex.get(operation.key);
      return index === undefined || (activeDeltaIndexes.has(index) && !rejectedDeltaIndexes.has(index));
    }),
    rejected,
    compiled,
  };
}
