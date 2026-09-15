import { parseChineseTime } from '../engine/time';
import { classifyEventCandidates, shouldAdmitNewEvent } from './action-context';
import type {
  AssistantActionContext,
  AssistantActionRejection,
  AssistantObjectRef,
  AssistantOperationProposal,
  ValidatedAssistantOperation,
} from './action-types';

function normalized(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function sameMeaningfulText(left: string, right: string): boolean {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function resolveCandidateId(ref: AssistantObjectRef): string | null {
  return ref.kind === 'candidate' ? ref.id : null;
}

export function validateAssistantActions(input: {
  operations: AssistantOperationProposal[];
  actionContext: AssistantActionContext;
  currentMessage: string;
  recentEvidence: string[];
  referenceAt: number;
}): { accepted: ValidatedAssistantOperation[]; rejected: AssistantActionRejection[] } {
  const accepted: ValidatedAssistantOperation[] = [];
  const rejected: AssistantActionRejection[] = [];
  const eventIds = new Set(input.actionContext.events.map(event => event.id));
  const todoIds = new Set(input.actionContext.todos.map(todo => todo.id));
  const localEventRefs = new Set<string>();
  const localTodoRefs = new Set<string>();
  const eventDecision = classifyEventCandidates(input.actionContext.events);

  const reject = (operation: AssistantOperationProposal, reason: AssistantActionRejection['reason']) => {
    rejected.push({ key: operation.key, type: operation.type, reason });
  };
  const eventAllowed = (eventId: string) => {
    if (!eventIds.has(eventId)
      && eventId !== input.actionContext.explicitEventId
      && eventId !== input.actionContext.segmentEventId) return 'candidate_not_allowed' as const;
    if (eventDecision.kind === 'ambiguous'
      && eventId !== input.actionContext.explicitEventId
      && eventId !== input.actionContext.segmentEventId) return 'ambiguous_candidate' as const;
    return null;
  };
  const refAllowed = (ref: AssistantObjectRef, kind: 'event' | 'todo') => {
    if (ref.kind === 'candidate') {
      return kind === 'event' ? eventAllowed(ref.id) : todoIds.has(ref.id) ? null : 'candidate_not_allowed' as const;
    }
    const allowed = kind === 'event' ? localEventRefs.has(ref.ref) : localTodoRefs.has(ref.ref);
    return allowed ? null : 'invalid_local_reference' as const;
  };

  for (const operation of input.operations) {
    if (operation.type === 'create_todo') {
      let dueAt: number | null = null;
      if (operation.dateText) {
        dueAt = parseChineseTime(operation.dateText, input.referenceAt).dueAt;
        if (dueAt === null) {
          reject(operation, 'invalid_date');
          continue;
        }
      }
      accepted.push({ ...operation, dueAt });
      localTodoRefs.add(operation.todoRef);
      continue;
    }

    if (operation.type === 'update_todo') {
      if (!todoIds.has(operation.todoId)) {
        reject(operation, 'candidate_not_allowed');
        continue;
      }
      if (operation.dateText) {
        const dueAt = parseChineseTime(operation.dateText, input.referenceAt).dueAt;
        if (dueAt === null) {
          reject(operation, 'invalid_date');
          continue;
        }
        accepted.push({ ...operation, dueAt });
      } else {
        accepted.push(operation);
      }
      continue;
    }

    if (operation.type === 'complete_todo') {
      if (!todoIds.has(operation.todoId)) reject(operation, 'candidate_not_allowed');
      else accepted.push(operation);
      continue;
    }

    if (operation.type === 'create_event') {
      if (!shouldAdmitNewEvent(input.currentMessage, input.recentEvidence)) {
        reject(operation, 'event_admission_failed');
        continue;
      }
      accepted.push(operation);
      localEventRefs.add(operation.eventRef);
      continue;
    }

    if (operation.type === 'update_event') {
      const denied = eventAllowed(operation.eventId);
      if (denied) {
        reject(operation, denied);
        continue;
      }
      const candidate = input.actionContext.events.find(event => event.id === operation.eventId);
      if (candidate && sameMeaningfulText(candidate.currentState, operation.currentState)) {
        reject(operation, 'duplicate_content');
        continue;
      }
      accepted.push(operation);
      continue;
    }

    if (operation.type === 'append_event_update') {
      const denied = refAllowed(operation.event, 'event');
      if (denied) {
        reject(operation, denied);
        continue;
      }
      const eventId = resolveCandidateId(operation.event);
      const candidate = input.actionContext.events.find(event => event.id === eventId);
      const existingTexts = candidate
        ? [candidate.currentState, ...(candidate.recentUpdateTexts ?? [])]
        : [];
      if (existingTexts.some(text => sameMeaningfulText(text, operation.content))) {
        reject(operation, 'duplicate_content');
        continue;
      }
      accepted.push(operation);
      continue;
    }

    if (operation.type === 'rename_event' || operation.type === 'pin_event') {
      const denied = eventAllowed(operation.eventId);
      if (denied) reject(operation, denied);
      else accepted.push(operation);
      continue;
    }

    const todoDenied = refAllowed(operation.todo, 'todo');
    const eventDenied = refAllowed(operation.event, 'event');
    if (todoDenied || eventDenied) reject(operation, todoDenied ?? eventDenied!);
    else accepted.push(operation);
  }

  return { accepted, rejected };
}

