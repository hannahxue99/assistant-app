import type { AssistantEvent, AssistantEventUpdate, AssistantObjectRelation, AssistantOperation } from '../assistant/action-types';
import type { AssistantMemory, AssistantMemorySource } from '../assistant/memory-types';
import type { ConversationSegment } from '../assistant/types';
import type { Entry } from '../types';
import type {
  BackupAssistantMessage,
  BackupAssistantRequest,
  BackupEventAlias,
  BackupPayloadV3,
  BackupV3ObjectKind,
} from './backup-v3-format';
import {
  classifyEntryImport,
  classifyMemoryImport,
  entriesHaveSameContent,
  isDefaultProfile,
  memoriesHaveSameContent,
} from './import-merge';

export type BackupV3LocalState = BackupPayloadV3;
export type BackupV3MergeAction = 'add' | 'update' | 'ignore' | 'keep-local' | 'skip-group';
export type BackupV3OperationAction = 'add' | 'ignore' | 'keep-local' | 'skip';
type OperationTargetType = 'todo' | 'event' | 'event_update' | 'relation' | 'memory';

export interface BackupV3MergeDecision<T> {
  action: BackupV3MergeAction;
  incoming: T;
  local: T | null;
  reason: string;
}

export interface BackupV3OperationDecision {
  action: BackupV3OperationAction;
  incoming: AssistantOperation;
  local: AssistantOperation | null;
  reason: string;
}

export interface BackupV3Conflict {
  objectKind: BackupV3ObjectKind;
  objectId: string;
  local: unknown;
  incoming: unknown;
  winner: 'local' | 'incoming';
  reason: string;
}

export interface BackupV3ImportPreview {
  added: number;
  updated: number;
  ignored: number;
  conflicts: number;
  operationSkipped: number;
  profileWillImport: boolean;
  objectCounts: {
    conversations: number;
    todos: number;
    events: number;
    eventUpdates: number;
    relations: number;
    memories: number;
  };
  conversationRange: { firstAt: number; lastAt: number } | null;
}

export interface BackupV3ImportPlan {
  entries: BackupV3MergeDecision<Entry>[];
  conversationSegments: BackupV3MergeDecision<ConversationSegment>[];
  assistantRequests: BackupV3MergeDecision<BackupAssistantRequest>[];
  assistantMessages: BackupV3MergeDecision<BackupAssistantMessage>[];
  events: BackupV3MergeDecision<AssistantEvent>[];
  eventAliases: BackupV3MergeDecision<BackupEventAlias>[];
  eventUpdates: BackupV3MergeDecision<AssistantEventUpdate>[];
  objectRelations: BackupV3MergeDecision<AssistantObjectRelation>[];
  operations: BackupV3OperationDecision[];
  memories: BackupV3MergeDecision<AssistantMemory>[];
  memorySources: BackupV3MergeDecision<AssistantMemorySource>[];
  conflicts: BackupV3Conflict[];
  preview: BackupV3ImportPreview;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function byId<T extends { id: string }>(values: T[]): Map<string, T> {
  return new Map(values.map(value => [value.id, value]));
}

function conflict<T extends { id: string }>(
  objectKind: BackupV3ObjectKind,
  decision: BackupV3MergeDecision<T>,
): BackupV3Conflict | null {
  if (!decision.local || !['update', 'keep-local', 'skip-group'].includes(decision.action)) return null;
  return {
    objectKind,
    objectId: decision.incoming.id,
    local: decision.local,
    incoming: decision.incoming,
    winner: decision.action === 'update' ? 'incoming' : 'local',
    reason: decision.reason,
  };
}

function immutableDecisions<T extends { id: string }>(
  incoming: T[],
  local: T[],
): BackupV3MergeDecision<T>[] {
  const localById = byId(local);
  return incoming.map(item => {
    const existing = localById.get(item.id) ?? null;
    if (!existing) return { action: 'add', incoming: item, local: null, reason: 'missing_local' };
    if (same(item, existing)) return { action: 'ignore', incoming: item, local: existing, reason: 'identical' };
    return { action: 'keep-local', incoming: item, local: existing, reason: 'immutable_id_conflict' };
  });
}

function entryDecisions(incoming: Entry[], local: Entry[]): BackupV3MergeDecision<Entry>[] {
  const localById = byId(local);
  return incoming.map(item => {
    const existing = localById.get(item.id) ?? null;
    const result = classifyEntryImport(item, existing);
    return { action: result.action, incoming: item, local: existing, reason: result.reason };
  });
}

function eventDecisions(incoming: AssistantEvent[], local: AssistantEvent[]): BackupV3MergeDecision<AssistantEvent>[] {
  const localById = byId(local);
  return incoming.map(item => {
    const existing = localById.get(item.id) ?? null;
    if (!existing) return { action: 'add', incoming: item, local: null, reason: 'missing_local' };
    if (same(item, existing)) return { action: 'ignore', incoming: item, local: existing, reason: 'identical' };
    if (item.revision > existing.revision) return { action: 'update', incoming: item, local: existing, reason: 'incoming_newer' };
    return {
      action: 'keep-local', incoming: item, local: existing,
      reason: item.revision < existing.revision ? 'local_newer' : 'same_revision',
    };
  });
}

function memoryDecisions(incoming: AssistantMemory[], local: AssistantMemory[]): BackupV3MergeDecision<AssistantMemory>[] {
  const localById = byId(local);
  return incoming.map(item => {
    const existing = localById.get(item.id) ?? null;
    const result = classifyMemoryImport(item, existing);
    let reason = 'identical';
    if (result.action === 'add') reason = 'missing_local';
    else if (result.action === 'update') reason = 'incoming_newer';
    else if (result.action === 'keep-local') reason = existing && item.revision < existing.revision ? 'local_newer' : 'same_revision';
    return { action: result.action, incoming: item, local: existing, reason };
  });
}

function segmentDecisions(
  incoming: ConversationSegment[],
  local: ConversationSegment[],
): BackupV3MergeDecision<ConversationSegment>[] {
  const localById = byId(local);
  const localCurrent = local.find(segment => segment.status === 'current') ?? null;
  return incoming.map(original => {
    let item = original;
    let forcedReason: string | null = null;
    if (original.status === 'current' && localCurrent && localCurrent.id !== original.id) {
      item = { ...original, status: 'closed', endedAt: original.endedAt ?? original.updatedAt };
      forcedReason = 'local_current_preserved';
    }
    const existing = localById.get(item.id) ?? null;
    if (!existing) return { action: 'add', incoming: item, local: null, reason: forcedReason ?? 'missing_local' };
    if (same(item, existing)) return { action: 'ignore', incoming: item, local: existing, reason: 'identical' };
    if (item.updatedAt > existing.updatedAt) {
      return { action: 'update', incoming: item, local: existing, reason: forcedReason ?? 'incoming_newer' };
    }
    return {
      action: 'keep-local', incoming: item, local: existing,
      reason: forcedReason ?? (item.updatedAt < existing.updatedAt ? 'local_newer' : 'same_revision'),
    };
  });
}

function requestAndMessageDecisions(
  incoming: BackupPayloadV3,
  local: BackupV3LocalState,
) {
  const localRequests = byId(local.assistantRequests);
  const localMessages = byId(local.assistantMessages);
  const skippedRequests = new Set<string>();
  const requests: BackupV3MergeDecision<BackupAssistantRequest>[] = incoming.assistantRequests.map(request => {
    const existing = localRequests.get(request.id) ?? null;
    const incomingUser = incoming.assistantMessages.find(message => message.id === request.userMessageId)!;
    const existingUser = localMessages.get(request.userMessageId) ?? null;
    if ((existing && !same(existing, request)) || (existingUser && !same(existingUser, incomingUser))) {
      skippedRequests.add(request.id);
      return { action: 'skip-group', incoming: request, local: existing, reason: 'request_user_message_conflict' };
    }
    if (!existing) return { action: 'add', incoming: request, local: null, reason: 'missing_local' };
    return { action: 'ignore', incoming: request, local: existing, reason: 'identical' };
  });
  const messages: BackupV3MergeDecision<BackupAssistantMessage>[] = incoming.assistantMessages.map(message => {
    const existing = localMessages.get(message.id) ?? null;
    if (skippedRequests.has(message.requestId)) {
      return { action: 'skip-group', incoming: message, local: existing, reason: 'request_group_skipped' };
    }
    if (!existing) return { action: 'add', incoming: message, local: null, reason: 'missing_local' };
    if (same(existing, message)) return { action: 'ignore', incoming: message, local: existing, reason: 'identical' };
    skippedRequests.add(message.requestId);
    return { action: 'skip-group', incoming: message, local: existing, reason: 'request_message_conflict' };
  });
  if (skippedRequests.size > 0) {
    for (const request of requests) {
      if (skippedRequests.has(request.incoming.id)) {
        request.action = 'skip-group';
        request.reason = 'request_message_conflict';
      }
    }
    for (const message of messages) {
      if (skippedRequests.has(message.incoming.requestId)) {
        message.action = 'skip-group';
        message.reason = 'request_group_skipped';
      }
    }
  }
  return { requests, messages, skippedRequests };
}

function effectiveById<T extends { id: string }>(decisions: BackupV3MergeDecision<T>[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const decision of decisions) {
    if (decision.action === 'keep-local' || decision.action === 'skip-group') {
      if (decision.local) result.set(decision.incoming.id, decision.local);
    } else {
      result.set(decision.incoming.id, decision.incoming);
    }
  }
  return result;
}

function relationSnapshotMatches(target: unknown, snapshot: unknown): boolean {
  if (!target || !snapshot || typeof target !== 'object' || typeof snapshot !== 'object') return false;
  const current = target as AssistantObjectRelation;
  const saved = snapshot as Record<string, unknown>;
  return current.id === saved.id
    && current.fromType === (saved.fromType ?? saved.from_type)
    && current.fromId === (saved.fromId ?? saved.from_id)
    && current.relationType === (saved.relationType ?? saved.relation_type)
    && current.toType === (saved.toType ?? saved.to_type)
    && current.toId === (saved.toId ?? saved.to_id)
    && current.sourceMessageId === (saved.sourceMessageId ?? saved.source_message_id ?? null)
    && current.createdAt === Number(saved.createdAt ?? saved.created_at)
    && current.undoneAt === (saved.undoneAt ?? saved.undone_at ?? null);
}

function operationTargetMatches(
  operation: AssistantOperation,
  snapshot: unknown,
  targets: Record<OperationTargetType, Map<string, unknown>>,
): boolean {
  if (operation.objectType === 'message') return false;
  const target = targets[operation.objectType].get(operation.objectId);
  if (operation.status === 'undone') return true;
  if (!snapshot || typeof snapshot !== 'object') return false;
  const value = snapshot as Record<string, unknown>;

  if (operation.operationType === 'delete_todo') {
    return target === undefined && value.deleted === true && value.todoId === operation.objectId;
  }
  if (operation.operationType === 'delete_event') {
    const deletedTodoIds = Array.isArray(value.deletedTodoIds) ? value.deletedTodoIds : [];
    return same(target, value.event)
      && deletedTodoIds.every(id => typeof id === 'string' && !targets.todo.has(id));
  }
  if (operation.operationType === 'append_event_update') {
    const event = value.event as { id?: unknown } | undefined;
    return same(target, value.update)
      && typeof event?.id === 'string'
      && same(targets.event.get(event.id), event);
  }
  if (operation.operationType === 'delete_event_update') {
    const event = value.event as { id?: unknown } | undefined;
    const update = target as AssistantEventUpdate | undefined;
    return !!update?.undoneAt
      && typeof event?.id === 'string'
      && same(targets.event.get(event.id), event);
  }
  if (operation.operationType === 'supersede_memory') {
    const oldMemory = value.old as { id?: unknown } | undefined;
    const successor = value.successor as { id?: unknown } | undefined;
    return same(target, oldMemory)
      && typeof successor?.id === 'string'
      && same(targets.memory.get(successor.id), successor);
  }
  if (operation.objectType === 'relation') return relationSnapshotMatches(target, snapshot);
  return same(target, snapshot);
}

function buildOperationDecisions(
  incoming: AssistantOperation[],
  local: AssistantOperation[],
  skippedRequests: Set<string>,
  targets: Record<OperationTargetType, Map<string, unknown>>,
): BackupV3OperationDecision[] {
  const localById = byId(local);
  return incoming.map(operation => {
    const existing = localById.get(operation.id) ?? null;
    if (skippedRequests.has(operation.requestId)) {
      return { action: 'skip', incoming: operation, local: existing, reason: 'request_group_skipped' };
    }
    if (existing) {
      if (same(existing, operation)) return { action: 'ignore', incoming: operation, local: existing, reason: 'identical' };
      return { action: 'keep-local', incoming: operation, local: existing, reason: 'immutable_id_conflict' };
    }
    if (operation.objectType === 'message') {
      return { action: 'skip', incoming: operation, local: null, reason: 'unsupported_operation_target' };
    }
    let afterSnapshot: unknown;
    try {
      afterSnapshot = JSON.parse(operation.afterSnapshot);
    } catch {
      return { action: 'skip', incoming: operation, local: null, reason: 'invalid_after_snapshot' };
    }
    if (!operationTargetMatches(operation, afterSnapshot, targets)) {
      return { action: 'skip', incoming: operation, local: null, reason: 'target_snapshot_mismatch' };
    }
    return { action: 'add', incoming: operation, local: null, reason: 'target_matches_after_snapshot' };
  });
}

export function buildBackupV3ImportPlan(
  incoming: BackupPayloadV3,
  local: BackupV3LocalState,
): BackupV3ImportPlan {
  const entries = entryDecisions(incoming.entries, local.entries);
  const conversationSegments = segmentDecisions(incoming.conversationSegments, local.conversationSegments);
  const { requests: assistantRequests, messages: assistantMessages, skippedRequests } = requestAndMessageDecisions(incoming, local);
  const events = eventDecisions(incoming.events, local.events);
  const eventAliases = immutableDecisions(incoming.eventAliases, local.eventAliases);
  const eventUpdates = immutableDecisions(incoming.eventUpdates, local.eventUpdates);
  const objectRelations = immutableDecisions(incoming.objectRelations, local.objectRelations);
  const memories = memoryDecisions(incoming.memories, local.memories);
  const memorySources = immutableDecisions(incoming.memorySources, local.memorySources);

  const targets: Record<OperationTargetType, Map<string, unknown>> = {
    todo: effectiveById(entries),
    event: effectiveById(events),
    event_update: effectiveById(eventUpdates),
    relation: effectiveById(objectRelations),
    memory: effectiveById(memories),
  };
  const operations = buildOperationDecisions(incoming.operations, local.operations, skippedRequests, targets);

  const decisionGroups: Array<[BackupV3ObjectKind, BackupV3MergeDecision<any>[]]> = [
    ['entries', entries], ['conversationSegments', conversationSegments], ['assistantRequests', assistantRequests],
    ['assistantMessages', assistantMessages], ['events', events], ['eventAliases', eventAliases],
    ['eventUpdates', eventUpdates], ['objectRelations', objectRelations], ['memories', memories],
    ['memorySources', memorySources],
  ];
  const conflicts = decisionGroups.flatMap(([kind, decisions]) => decisions
    .map(decision => conflict(kind, decision)).filter((item): item is BackupV3Conflict => item !== null));
  for (const decision of conversationSegments) {
    if (decision.reason === 'local_current_preserved') {
      conflicts.push({
        objectKind: 'conversationSegments', objectId: decision.incoming.id,
        local: local.conversationSegments.find(segment => segment.status === 'current') ?? null,
        incoming: decision.incoming, winner: 'local', reason: decision.reason,
      });
    }
  }
  for (const operation of operations) {
    if (operation.action === 'keep-local' && operation.local) {
      conflicts.push({
        objectKind: 'operations', objectId: operation.incoming.id, local: operation.local,
        incoming: operation.incoming, winner: 'local', reason: operation.reason,
      });
    }
  }

  const mergeDecisions = decisionGroups.flatMap(([, decisions]) => decisions);
  const preview: BackupV3ImportPreview = {
    added: mergeDecisions.filter(decision => decision.action === 'add').length
      + operations.filter(decision => decision.action === 'add').length,
    updated: mergeDecisions.filter(decision => decision.action === 'update').length,
    ignored: mergeDecisions.filter(decision => decision.action === 'ignore').length
      + operations.filter(decision => decision.action === 'ignore').length,
    conflicts: conflicts.length,
    operationSkipped: operations.filter(decision => decision.action === 'skip').length,
    profileWillImport: isDefaultProfile(local.profile) && !isDefaultProfile(incoming.profile),
    objectCounts: {
      conversations: incoming.assistantMessages.length,
      todos: incoming.entries.filter(entry => entry.kind === 'task').length,
      events: incoming.events.length,
      eventUpdates: incoming.eventUpdates.length,
      relations: incoming.objectRelations.length,
      memories: incoming.memories.length,
    },
    conversationRange: incoming.assistantMessages.length === 0 ? null : {
      firstAt: Math.min(...incoming.assistantMessages.map(message => message.createdAt)),
      lastAt: Math.max(...incoming.assistantMessages.map(message => message.createdAt)),
    },
  };

  return {
    entries, conversationSegments, assistantRequests, assistantMessages, events, eventAliases,
    eventUpdates, objectRelations, operations, memories, memorySources, conflicts, preview,
  };
}

export function backupV3DecisionHasSameContent(
  kind: 'entries' | 'memories',
  left: Entry | AssistantMemory,
  right: Entry | AssistantMemory,
): boolean {
  return kind === 'entries'
    ? entriesHaveSameContent(left as Entry, right as Entry)
    : memoriesHaveSameContent(left as AssistantMemory, right as AssistantMemory);
}
