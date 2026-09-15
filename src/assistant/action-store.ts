import type { SQLiteDatabase } from 'expo-sqlite';

import {
  completeAssistantTaskWithDatabase,
  getEntryWithDatabase,
  insertAssistantTaskWithDatabase,
  updateAssistantTaskWithDatabase,
  withDatabaseConnection,
  withExclusiveDatabaseTransaction,
} from '../db';
import type {
  AssistantActionContext,
  AssistantObjectRef,
  AssistantOperation,
  ValidatedAssistantOperation,
} from './action-types';
import {
  appendEventUpdate,
  createEvent,
  getEvent,
  linkObjects,
  renameEvent,
  setEventPinned,
  updateEventState,
} from './event-store';
import { completeTurnWithDatabase } from './store';
import type { AssistantMessage, AssistantMessageSource, AssistantSegmentDecision } from './types';

function stableHash(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function deterministicId(prefix: string, requestId: string, key: string): string {
  return `${prefix}-${stableHash(`${requestId}:${key}`)}`;
}

function rowToOperation(row: any): AssistantOperation {
  return {
    id: row.id,
    requestId: row.request_id,
    operationKey: row.operation_key,
    operationType: row.operation_type,
    objectType: row.object_type,
    objectId: row.object_id,
    beforeSnapshot: row.before_snapshot ?? null,
    afterSnapshot: row.after_snapshot,
    receiptSummary: row.receipt_summary,
    status: row.status,
    sequence: Number(row.sequence),
    createdAt: Number(row.created_at),
    undoneAt: row.undone_at ?? null,
  };
}

async function insertOperation(database: SQLiteDatabase, input: {
  requestId: string;
  operation: ValidatedAssistantOperation;
  objectType: AssistantOperation['objectType'];
  objectId: string;
  before: unknown | null;
  after: unknown;
  receiptSummary: string;
  sequence: number;
  createdAt: number;
}): Promise<AssistantOperation> {
  const id = deterministicId('assistant-operation', input.requestId, input.operation.key);
  await database.runAsync(
    `INSERT INTO assistant_operations (
       id, request_id, operation_key, operation_type, object_type, object_id,
       before_snapshot, after_snapshot, receipt_summary, status, sequence, created_at, undone_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?, NULL)`,
    id, input.requestId, input.operation.key, input.operation.type, input.objectType, input.objectId,
    input.before === null ? null : JSON.stringify(input.before), JSON.stringify(input.after),
    input.receiptSummary, input.sequence, input.createdAt,
  );
  return rowToOperation(await database.getFirstAsync<any>('SELECT * FROM assistant_operations WHERE id=?', id));
}

function referenceId(ref: AssistantObjectRef, localRefs: Map<string, string>): string | null {
  return ref.kind === 'candidate' ? ref.id : localRefs.get(ref.ref) ?? null;
}

async function linkMessageSource(
  database: SQLiteDatabase,
  input: { requestId: string; operationKey: string; messageId: string; objectType: 'todo' | 'event'; objectId: string; createdAt: number },
): Promise<void> {
  await linkObjects({
    id: deterministicId('assistant-source', input.requestId, `${input.operationKey}:${input.objectType}`),
    fromType: 'message',
    fromId: input.messageId,
    relationType: 'source',
    toType: input.objectType,
    toId: input.objectId,
    sourceMessageId: input.messageId,
    createdAt: input.createdAt,
  }, database);
}

async function applyActions(database: SQLiteDatabase, input: {
  requestId: string;
  userMessageId: string;
  userSource: AssistantMessageSource;
  operations: ValidatedAssistantOperation[];
  actionContext: AssistantActionContext;
  createdAt: number;
}): Promise<AssistantOperation[]> {
  const committed: AssistantOperation[] = [];
  const localTodoRefs = new Map<string, string>();
  const localEventRefs = new Map<string, string>();
  const todoRevisions = new Map(input.actionContext.todos.map(todo => [todo.id, todo.revisionAt]));
  const eventRevisions = new Map(input.actionContext.events.map(event => [event.id, event.revision]));
  let sequence = 0;

  for (const operation of input.operations) {
    if (operation.type === 'create_todo') {
      const todoId = deterministicId('assistant-todo', input.requestId, operation.key);
      const todo = await insertAssistantTaskWithDatabase(database, {
        id: todoId,
        text: operation.text,
        dueAt: operation.dueAt,
        timePrecision: operation.storedTimePrecision ?? (operation.dueAt === null ? null : 'date'),
        source: input.userSource === 'voice' ? 'voice' : 'text',
        createdAt: input.createdAt,
      });
      localTodoRefs.set(operation.todoRef, todo.id);
      todoRevisions.set(todo.id, todo.revisionAt);
      await linkMessageSource(database, {
        requestId: input.requestId,
        operationKey: operation.key,
        messageId: input.userMessageId,
        objectType: 'todo',
        objectId: todo.id,
        createdAt: input.createdAt,
      });
      committed.push(await insertOperation(database, {
        requestId: input.requestId,
        operation,
        objectType: 'todo',
        objectId: todo.id,
        before: null,
        after: todo,
        receiptSummary: `建立待办：${todo.summary}`,
        sequence: sequence++,
        createdAt: input.createdAt,
      }));
      continue;
    }

    if (operation.type === 'update_todo' || operation.type === 'complete_todo') {
      const expectedRevisionAt = todoRevisions.get(operation.todoId);
      const before = await getEntryWithDatabase(database, operation.todoId);
      if (!before || expectedRevisionAt === undefined || before.revisionAt !== expectedRevisionAt) continue;
      const after = operation.type === 'update_todo'
        ? await updateAssistantTaskWithDatabase(database, {
          id: operation.todoId,
          expectedRevisionAt,
          text: operation.text,
          dueAt: operation.dueAt,
          timePrecision: operation.storedTimePrecision,
          updatedAt: input.createdAt,
        })
        : await completeAssistantTaskWithDatabase(database, {
          id: operation.todoId,
          expectedRevisionAt,
          completedAt: input.createdAt,
        });
      if (!after) continue;
      todoRevisions.set(after.id, after.revisionAt);
      await linkMessageSource(database, {
        requestId: input.requestId,
        operationKey: operation.key,
        messageId: input.userMessageId,
        objectType: 'todo',
        objectId: after.id,
        createdAt: input.createdAt,
      });
      committed.push(await insertOperation(database, {
        requestId: input.requestId,
        operation,
        objectType: 'todo',
        objectId: after.id,
        before,
        after,
        receiptSummary: operation.type === 'complete_todo'
          ? `完成待办：${after.summary}`
          : `更新待办：${after.summary}`,
        sequence: sequence++,
        createdAt: input.createdAt,
      }));
      continue;
    }

    if (operation.type === 'create_event') {
      const eventId = deterministicId('assistant-event', input.requestId, operation.key);
      const event = await createEvent({
        id: eventId,
        title: operation.title,
        currentState: operation.currentState,
        createdAt: input.createdAt,
      }, database);
      localEventRefs.set(operation.eventRef, event.id);
      eventRevisions.set(event.id, event.revision);
      await linkMessageSource(database, {
        requestId: input.requestId,
        operationKey: operation.key,
        messageId: input.userMessageId,
        objectType: 'event',
        objectId: event.id,
        createdAt: input.createdAt,
      });
      committed.push(await insertOperation(database, {
        requestId: input.requestId,
        operation,
        objectType: 'event',
        objectId: event.id,
        before: null,
        after: event,
        receiptSummary: `建立事件：${event.title}`,
        sequence: sequence++,
        createdAt: input.createdAt,
      }));
      continue;
    }

    if (operation.type === 'update_event' || operation.type === 'rename_event' || operation.type === 'pin_event') {
      const expectedRevision = eventRevisions.get(operation.eventId);
      const before = await getEvent(operation.eventId, database);
      if (!before || expectedRevision === undefined || before.revision !== expectedRevision) continue;
      const after = operation.type === 'update_event'
        ? await updateEventState({
          eventId: operation.eventId,
          currentState: operation.currentState,
          expectedRevision,
          updatedAt: input.createdAt,
        }, database)
        : operation.type === 'rename_event'
          ? await renameEvent({
            eventId: operation.eventId,
            title: operation.title,
            expectedRevision,
            updatedAt: input.createdAt,
          }, database)
          : await setEventPinned({
            eventId: operation.eventId,
            pinned: operation.pinned,
            expectedRevision,
            updatedAt: input.createdAt,
          }, database);
      if (!after || after.revision === before.revision) continue;
      eventRevisions.set(after.id, after.revision);
      await linkMessageSource(database, {
        requestId: input.requestId,
        operationKey: operation.key,
        messageId: input.userMessageId,
        objectType: 'event',
        objectId: after.id,
        createdAt: input.createdAt,
      });
      const label = operation.type === 'update_event'
        ? '更新事件'
        : operation.type === 'rename_event' ? '重命名事件' : operation.pinned ? '置顶事件' : '取消置顶事件';
      committed.push(await insertOperation(database, {
        requestId: input.requestId,
        operation,
        objectType: 'event',
        objectId: after.id,
        before,
        after,
        receiptSummary: `${label}：${after.title}`,
        sequence: sequence++,
        createdAt: input.createdAt,
      }));
      continue;
    }

    if (operation.type === 'append_event_update') {
      const eventId = referenceId(operation.event, localEventRefs);
      if (!eventId) continue;
      const before = await getEvent(eventId, database);
      const expectedRevision = eventRevisions.get(eventId);
      if (!before || expectedRevision === undefined || before.revision !== expectedRevision) continue;
      const update = await appendEventUpdate({
        id: deterministicId('assistant-event-update', input.requestId, operation.key),
        eventId,
        content: operation.content,
        occurredAt: input.createdAt,
        sourceMessageId: input.userMessageId,
        stableKey: `${input.requestId}:${operation.key}`,
      }, database);
      const afterEvent = await getEvent(eventId, database);
      if (!afterEvent) throw new Error('事件进展写入后事件丢失');
      eventRevisions.set(eventId, afterEvent.revision);
      await linkMessageSource(database, {
        requestId: input.requestId,
        operationKey: operation.key,
        messageId: input.userMessageId,
        objectType: 'event',
        objectId: eventId,
        createdAt: input.createdAt,
      });
      committed.push(await insertOperation(database, {
        requestId: input.requestId,
        operation,
        objectType: 'event_update',
        objectId: update.id,
        before,
        after: { update, event: afterEvent },
        receiptSummary: `追加进展：${update.content}`,
        sequence: sequence++,
        createdAt: input.createdAt,
      }));
      continue;
    }

    const todoId = referenceId(operation.todo, localTodoRefs);
    const eventId = referenceId(operation.event, localEventRefs);
    if (!todoId || !eventId) continue;
    const todo = await getEntryWithDatabase(database, todoId);
    const event = await getEvent(eventId, database);
    if (!todo || !event) continue;
    const existing = await database.getFirstAsync<any>(
      `SELECT * FROM assistant_object_relations
       WHERE from_type='todo' AND from_id=? AND relation_type='belongs_to'
         AND to_type='event' AND to_id=? AND undone_at IS NULL`,
      todoId, eventId,
    );
    if (existing) continue;
    const relation = await linkObjects({
      id: deterministicId('assistant-relation', input.requestId, operation.key),
      fromType: 'todo',
      fromId: todoId,
      relationType: 'belongs_to',
      toType: 'event',
      toId: eventId,
      sourceMessageId: input.userMessageId,
      createdAt: input.createdAt,
    }, database);
    committed.push(await insertOperation(database, {
      requestId: input.requestId,
      operation,
      objectType: 'relation',
      objectId: relation.id,
      before: null,
      after: relation,
      receiptSummary: `关联待办：${todo.summary} → ${event.title}`,
      sequence: sequence++,
      createdAt: input.createdAt,
    }));
  }

  return committed;
}

export function listCommittedOperationsByRequest(
  requestId: string,
  database?: SQLiteDatabase,
): Promise<AssistantOperation[]> {
  const read = async (connection: SQLiteDatabase) => {
    const rows = await connection.getAllAsync<any>(
      `SELECT * FROM assistant_operations
       WHERE request_id=? ORDER BY sequence, id`,
      requestId,
    );
    return rows.map(rowToOperation);
  };
  return database ? read(database) : withDatabaseConnection(read);
}

export function listOperationsByRequestIds(
  requestIds: string[],
): Promise<Map<string, AssistantOperation[]>> {
  const ids = [...new Set(requestIds.filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return Promise.resolve(new Map());
  return withDatabaseConnection(async (database) => {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM assistant_operations
       WHERE request_id IN (${placeholders})
       ORDER BY request_id, sequence, id`,
      ...ids,
    );
    const result = new Map<string, AssistantOperation[]>();
    for (const row of rows) {
      const operation = rowToOperation(row);
      result.set(operation.requestId, [...(result.get(operation.requestId) ?? []), operation]);
    }
    return result;
  });
}

export async function completeAssistantTurnWithActions(input: {
  requestId: string;
  userMessageId: string;
  userSource: AssistantMessageSource;
  reply: string;
  segment: AssistantSegmentDecision;
  operations: ValidatedAssistantOperation[];
  actionContext: AssistantActionContext;
  createdAt?: number;
}): Promise<{ assistantMessage: AssistantMessage; operations: AssistantOperation[] }> {
  const createdAt = input.createdAt ?? Date.now();
  return withExclusiveDatabaseTransaction(async (database) => {
    const operations = await applyActions(database, { ...input, createdAt });
    const assistantMessage = await completeTurnWithDatabase(database, {
      requestId: input.requestId,
      reply: input.reply,
      segment: input.segment,
      createdAt,
    });
    return { assistantMessage, operations };
  });
}
