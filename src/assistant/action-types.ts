export type AssistantObjectType = 'message' | 'todo' | 'event' | 'event_update' | 'relation';
export type AssistantEventStatus = 'active' | 'closed';
export type AssistantOperationStatus = 'committed' | 'undone';
export type AssistantRelationType = 'source' | 'belongs_to' | 'follows' | 'related';

export interface AssistantEvent {
  id: string;
  title: string;
  currentState: string;
  status: AssistantEventStatus;
  pinnedAt: number | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface AssistantEventUpdate {
  id: string;
  eventId: string;
  content: string;
  occurredAt: number;
  sourceMessageId: string | null;
  stableKey: string;
  createdAt: number;
  undoneAt: number | null;
}

export interface AssistantEventTodo {
  id: string;
  text: string;
  dueAt: number | null;
  done: boolean;
  updatedAt: number;
}

export interface AssistantEventDetail {
  event: AssistantEvent;
  todos: AssistantEventTodo[];
  updates: AssistantEventUpdate[];
}

export interface AssistantObjectRelation {
  id: string;
  fromType: AssistantObjectType;
  fromId: string;
  relationType: AssistantRelationType;
  toType: AssistantObjectType;
  toId: string;
  sourceMessageId: string | null;
  createdAt: number;
  undoneAt: number | null;
}

export type AssistantOperationType =
  | 'create_todo'
  | 'update_todo'
  | 'complete_todo'
  | 'create_event'
  | 'update_event'
  | 'append_event_update'
  | 'rename_event'
  | 'pin_event'
  | 'link_todo_event';

export interface AssistantOperation {
  id: string;
  requestId: string;
  operationKey: string;
  operationType: AssistantOperationType;
  objectType: AssistantObjectType;
  objectId: string;
  beforeSnapshot: string | null;
  afterSnapshot: string;
  receiptSummary: string;
  status: AssistantOperationStatus;
  sequence: number;
  createdAt: number;
  undoneAt: number | null;
}

export type AssistantObjectRef =
  | { kind: 'candidate'; id: string }
  | { kind: 'local'; ref: string };

export type AssistantOperationProposal =
  | { key: string; type: 'create_todo'; todoRef: string; text: string; dateText?: string }
  | { key: string; type: 'update_todo'; todoId: string; text?: string; dateText?: string }
  | { key: string; type: 'complete_todo'; todoId: string }
  | { key: string; type: 'create_event'; eventRef: string; title: string; currentState: string }
  | { key: string; type: 'update_event'; eventId: string; currentState: string }
  | { key: string; type: 'append_event_update'; event: AssistantObjectRef; content: string }
  | { key: string; type: 'rename_event'; eventId: string; title: string }
  | { key: string; type: 'pin_event'; eventId: string; pinned: boolean }
  | { key: string; type: 'link_todo_event'; todo: AssistantObjectRef; event: AssistantObjectRef };

export interface AssistantEventCandidate {
  id: string;
  title: string;
  currentState: string;
  aliases: string[];
  linkedTodoTexts: string[];
  recentUpdateTexts?: string[];
  revision: number;
  updatedAt: number;
  score: number;
}

export interface AssistantTodoCandidate {
  id: string;
  text: string;
  dueAt: number | null;
  revisionAt: number;
  updatedAt: number;
  score: number;
}

export interface AssistantActionContext {
  events: AssistantEventCandidate[];
  todos: AssistantTodoCandidate[];
  explicitEventId: string | null;
  segmentEventId: string | null;
  segmentTodoId?: string | null;
}

export type ValidatedAssistantOperation =
  | (Extract<AssistantOperationProposal, { type: 'create_todo' }> & { dueAt: number | null })
  | (Extract<AssistantOperationProposal, { type: 'update_todo' }> & { dueAt?: number })
  | Exclude<AssistantOperationProposal, { type: 'create_todo' | 'update_todo' }>;

export interface AssistantActionRejection {
  key: string;
  type: AssistantOperationType;
  reason:
    | 'candidate_not_allowed'
    | 'ambiguous_candidate'
    | 'event_admission_failed'
    | 'duplicate_content'
    | 'invalid_date'
    | 'invalid_local_reference';
}
