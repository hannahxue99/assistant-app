import type { SQLiteDatabase } from 'expo-sqlite';

import {
  deleteAssistantTaskWithDatabase,
  getEntryWithDatabase,
  restoreAssistantTaskWithDatabase,
  withExclusiveDatabaseTransaction,
} from '../db';
import type { Entry } from '../types';
import type { AssistantEvent, AssistantOperation } from './action-types';
import { listCommittedOperationsByRequest } from './action-store';
import { getEvent } from './event-store';

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
  for (const operation of operations) {
    if (operation.objectType === 'todo') {
      const after = parseSnapshot<Entry>(operation.afterSnapshot);
      if (after) todos.set(operation.objectId, after.revisionAt);
    } else if (operation.objectType === 'event') {
      const after = parseSnapshot<AssistantEvent>(operation.afterSnapshot);
      if (after) events.set(operation.objectId, after.revision);
    } else if (operation.objectType === 'event_update') {
      const after = parseSnapshot<{ event?: AssistantEvent }>(operation.afterSnapshot);
      if (after?.event) events.set(after.event.id, after.event.revision);
    }
  }
  return { todos, events };
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
  for (const operation of operations) {
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

async function undoOperation(
  database: SQLiteDatabase,
  operation: AssistantOperation,
  undoneAt: number,
): Promise<void> {
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

    for (const operation of [...operations].sort((left, right) => right.sequence - left.sequence)) {
      await undoOperation(database, operation, undoneAt);
    }
    const userMessage = await database.getFirstAsync<{ user_message_id: string }>(
      'SELECT user_message_id FROM assistant_requests WHERE id=?', requestId,
    );
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
