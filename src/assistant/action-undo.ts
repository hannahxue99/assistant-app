import type { SQLiteDatabase } from 'expo-sqlite';

import {
  deleteAssistantTaskWithDatabase,
  getEntryWithDatabase,
  reinsertAssistantTaskWithDatabase,
  restoreAssistantTaskWithDatabase,
  withExclusiveDatabaseTransaction,
} from '../db';
import type { Entry } from '../types';
import type { AssistantEvent, AssistantOperation } from './action-types';
import { listCommittedOperationsByRequest } from './action-store';
import { getEvent } from './event-store';
import { getMemoryWithDatabase } from './memory-store';
import type { AssistantMemory } from './memory-types';

export type AssistantUndoStatus = 'undone' | 'already-undone' | 'conflict';

function parseSnapshot<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function finalObjectRevisions(operations: AssistantOperation[]) {
  const todos = new Map<string, number>();
  const events = new Map<string, number>();
  const memories = new Map<string, { revision: number; status: AssistantMemory['status'] }>();
  for (const operation of operations) {
    if (operation.operationType === 'delete_todo' || operation.operationType === 'delete_event') continue;
    if (operation.objectType === 'todo') {
      const after = parseSnapshot<Entry>(operation.afterSnapshot);
      if (after) todos.set(operation.objectId, after.revisionAt);
    } else if (operation.objectType === 'event') {
      const after = parseSnapshot<AssistantEvent>(operation.afterSnapshot);
      if (after) events.set(operation.objectId, after.revision);
    } else if (operation.objectType === 'event_update') {
      const after = parseSnapshot<{ event?: AssistantEvent }>(operation.afterSnapshot);
      if (after?.event) events.set(after.event.id, after.event.revision);
    } else if (operation.objectType === 'memory') {
      if (operation.operationType === 'supersede_memory') {
        const after = parseSnapshot<{ old?: AssistantMemory; successor?: AssistantMemory }>(operation.afterSnapshot);
        if (after?.old) memories.set(after.old.id, { revision: after.old.revision, status: after.old.status });
        if (after?.successor) {
          memories.set(after.successor.id, { revision: after.successor.revision, status: after.successor.status });
        }
      } else {
        const after = parseSnapshot<AssistantMemory>(operation.afterSnapshot);
        if (after) memories.set(after.id, { revision: after.revision, status: after.status });
      }
    }
  }
  return { todos, events, memories };
}

async function canUndo(database: SQLiteDatabase, operations: AssistantOperation[]): Promise<boolean> {
  const revisions = finalObjectRevisions(operations);
  for (const [id, revisionAt] of revisions.todos) {
    const current = await getEntryWithDatabase(database, id);
    if (!current || current.revisionAt !== revisionAt) return false;
  }
  for (const [id, revision] of revisions.events) {
    const current = await getEvent(id, database);
    if (!current || current.revision !== revision) return false;
  }
  for (const [id, expected] of revisions.memories) {
    const current = await getMemoryWithDatabase(database, id);
    if (!current || current.revision !== expected.revision || current.status !== expected.status) return false;
  }
  for (const operation of operations) {
    if (operation.operationType === 'delete_todo') {
      if (await getEntryWithDatabase(database, operation.objectId)) return false;
      continue;
    }
    if (operation.operationType === 'delete_event') {
      const after = parseSnapshot<{ event?: AssistantEvent; deletedTodoIds?: string[] }>(operation.afterSnapshot);
      const current = await getEvent(operation.objectId, database);
      if (!after?.event || !current || current.status !== 'closed' || current.revision !== after.event.revision) return false;
      for (const todoId of after.deletedTodoIds ?? []) {
        if (await getEntryWithDatabase(database, todoId)) return false;
      }
      continue;
    }
    if (operation.objectType === 'event_update') {
      const row = await database.getFirstAsync(
        'SELECT id FROM assistant_event_updates WHERE id=? AND undone_at IS NULL', operation.objectId,
      );
      if (!row) return false;
    }
    if (operation.objectType === 'relation') {
      const row = await database.getFirstAsync(
        'SELECT id FROM assistant_object_relations WHERE id=? AND undone_at IS NULL', operation.objectId,
      );
      if (!row) return false;
    }
  }
  return true;
}

async function restoreRelations(database: SQLiteDatabase, relations: Array<{ id?: string }>): Promise<void> {
  for (const relation of relations) {
    if (!relation.id) throw new Error('关系撤销快照损坏');
    const result = await database.runAsync(
      'UPDATE assistant_object_relations SET undone_at=NULL WHERE id=?', relation.id,
    );
    if (result.changes === 0) throw new Error('关系撤销快照对应记录不存在');
  }
}

async function restoreEvent(
  database: SQLiteDatabase,
  snapshot: AssistantEvent,
  undoneAt: number,
): Promise<void> {
  await database.runAsync(
    `UPDATE assistant_events SET title=?, current_state=?, status=?, pinned_at=?,
       revision=revision+1, created_at=?, updated_at=?
     WHERE id=?`,
    snapshot.title, snapshot.currentState, snapshot.status, snapshot.pinnedAt,
    snapshot.createdAt, Math.max(snapshot.updatedAt, undoneAt), snapshot.id,
  );
}

async function restoreMemory(
  database: SQLiteDatabase,
  snapshot: AssistantMemory,
  updatedAt: number,
): Promise<void> {
  await database.runAsync(
    `UPDATE assistant_memories SET category=?, content=?, normalized_content=?, status=?,
       sensitivity=?, admission_basis=?, superseded_by_id=?, revision=revision+1,
       updated_at=?, activated_at=?, superseded_at=?, forgotten_at=? WHERE id=?`,
    snapshot.category, snapshot.content, snapshot.normalizedContent, snapshot.status,
    snapshot.sensitivity, snapshot.admissionBasis, snapshot.supersededById,
    Math.max(snapshot.updatedAt, updatedAt), snapshot.activatedAt, snapshot.supersededAt,
    snapshot.forgottenAt, snapshot.id,
  );
}

async function undoOperation(
  database: SQLiteDatabase,
  operation: AssistantOperation,
  undoneAt: number,
): Promise<void> {
  if (operation.operationType === 'delete_todo') {
    const before = parseSnapshot<{ todo?: Entry; relations?: Array<{ id?: string }> }>(operation.beforeSnapshot);
    if (!before?.todo) throw new Error('待办删除撤销快照损坏');
    await reinsertAssistantTaskWithDatabase(database, before.todo);
    await restoreRelations(database, before.relations ?? []);
    return;
  }

  if (operation.operationType === 'delete_event') {
    const before = parseSnapshot<{
      event?: AssistantEvent;
      deletedTodos?: Array<{ todo?: Entry; relations?: Array<{ id?: string }> }>;
    }>(operation.beforeSnapshot);
    if (!before?.event) throw new Error('事件删除撤销快照损坏');
    await restoreEvent(database, before.event, undoneAt);
    for (const snapshot of before.deletedTodos ?? []) {
      if (!snapshot.todo) throw new Error('事件关联待办撤销快照损坏');
      await reinsertAssistantTaskWithDatabase(database, snapshot.todo);
      await restoreRelations(database, snapshot.relations ?? []);
    }
    return;
  }

  if (operation.operationType === 'create_memory') {
    await database.runAsync('DELETE FROM assistant_memory_sources WHERE memory_id=?', operation.objectId);
    await database.runAsync('DELETE FROM assistant_memories WHERE id=?', operation.objectId);
    return;
  }

  if (operation.operationType === 'activate_memory' || operation.operationType === 'forget_memory') {
    const before = parseSnapshot<AssistantMemory>(operation.beforeSnapshot);
    if (!before) throw new Error('记忆撤销快照损坏');
    await restoreMemory(database, before, undoneAt);
    return;
  }

  if (operation.operationType === 'supersede_memory') {
    const before = parseSnapshot<AssistantMemory>(operation.beforeSnapshot);
    const after = parseSnapshot<{ successor?: AssistantMemory }>(operation.afterSnapshot);
    if (!before || !after?.successor) throw new Error('记忆更新撤销快照损坏');
    await database.runAsync('DELETE FROM assistant_memory_sources WHERE memory_id=?', after.successor.id);
    await database.runAsync('DELETE FROM assistant_memories WHERE id=?', after.successor.id);
    await restoreMemory(database, before, undoneAt);
    return;
  }

  if (operation.operationType === 'link_todo_event') {
    await database.runAsync(
      'UPDATE assistant_object_relations SET undone_at=? WHERE id=? AND undone_at IS NULL',
      undoneAt, operation.objectId,
    );
    return;
  }

  if (operation.operationType === 'append_event_update') {
    const beforeEvent = parseSnapshot<AssistantEvent>(operation.beforeSnapshot);
    await database.runAsync('DELETE FROM assistant_event_updates WHERE id=?', operation.objectId);
    if (beforeEvent) await restoreEvent(database, beforeEvent, undoneAt);
    return;
  }

  if (operation.operationType === 'create_todo') {
    await database.runAsync(
      `UPDATE assistant_object_relations SET undone_at=?
       WHERE ((from_type='todo' AND from_id=?) OR (to_type='todo' AND to_id=?))
         AND undone_at IS NULL`,
      undoneAt, operation.objectId, operation.objectId,
    );
    await deleteAssistantTaskWithDatabase(database, operation.objectId);
    return;
  }

  if (operation.operationType === 'update_todo' || operation.operationType === 'complete_todo') {
    const before = parseSnapshot<Entry>(operation.beforeSnapshot);
    if (!before) throw new Error('待办撤销快照损坏');
    await restoreAssistantTaskWithDatabase(database, before, undoneAt);
    return;
  }

  if (operation.operationType === 'create_event') {
    await database.runAsync('DELETE FROM assistant_event_updates WHERE event_id=?', operation.objectId);
    await database.runAsync('DELETE FROM assistant_event_aliases WHERE event_id=?', operation.objectId);
    await database.runAsync(
      `UPDATE assistant_object_relations SET undone_at=?
       WHERE ((from_type='event' AND from_id=?) OR (to_type='event' AND to_id=?))
         AND undone_at IS NULL`,
      undoneAt, operation.objectId, operation.objectId,
    );
    await database.runAsync('DELETE FROM assistant_events WHERE id=?', operation.objectId);
    return;
  }

  const before = parseSnapshot<AssistantEvent>(operation.beforeSnapshot);
  if (!before) throw new Error('事件撤销快照损坏');
  await restoreEvent(database, before, undoneAt);
  if (operation.operationType === 'rename_event') {
    await database.runAsync(
      'DELETE FROM assistant_event_aliases WHERE event_id=? AND alias=?',
      before.id, before.title,
    );
  }
}

export async function undoAssistantRequest(
  requestId: string,
  undoneAt = Date.now(),
): Promise<{ status: AssistantUndoStatus }> {
  return withExclusiveDatabaseTransaction(async (database) => {
    const all = await listCommittedOperationsByRequest(requestId, database);
    if (all.length === 0 || all.every(operation => operation.status === 'undone')) {
      return { status: 'already-undone' };
    }
    const operations = all.filter(operation => operation.status === 'committed');
    if (!(await canUndo(database, operations))) return { status: 'conflict' };

    const userMessage = await database.getFirstAsync<{ user_message_id: string }>(
      'SELECT user_message_id FROM assistant_requests WHERE id=?', requestId,
    );
    if (userMessage) {
      await database.runAsync(
        'DELETE FROM assistant_memory_sources WHERE source_message_id=?',
        userMessage.user_message_id,
      );
    }
    for (const operation of [...operations].sort((left, right) => right.sequence - left.sequence)) {
      await undoOperation(database, operation, undoneAt);
    }
    if (userMessage) {
      await database.runAsync(
        `UPDATE assistant_object_relations SET undone_at=?
         WHERE source_message_id=? AND undone_at IS NULL`,
        undoneAt, userMessage.user_message_id,
      );
    }
    await database.runAsync(
      `UPDATE assistant_operations SET status='undone', undone_at=?
       WHERE request_id=? AND status='committed'`,
      undoneAt, requestId,
    );
    return { status: 'undone' };
  });
}
