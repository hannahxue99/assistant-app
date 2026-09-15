import type { SQLiteDatabase } from 'expo-sqlite';

import {
  withDatabaseConnection,
  withExclusiveDatabaseTransaction,
} from '../db';
import type {
  AssistantEvent,
  AssistantEventUpdate,
  AssistantObjectRelation,
  AssistantObjectType,
  AssistantRelationType,
} from './action-types';

type EventWrite<T> = (database: SQLiteDatabase) => Promise<T>;

function makeId(prefix: string, now: number): string {
  return `${prefix}-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function compact(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length <= limit ? normalized : normalized.slice(0, limit);
}

function rowToEvent(row: any): AssistantEvent {
  return {
    id: row.id,
    title: row.title,
    currentState: row.current_state,
    status: row.status,
    pinnedAt: row.pinned_at ?? null,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToUpdate(row: any): AssistantEventUpdate {
  return {
    id: row.id,
    eventId: row.event_id,
    content: row.content,
    occurredAt: Number(row.occurred_at),
    sourceMessageId: row.source_message_id ?? null,
    stableKey: row.stable_key,
    createdAt: Number(row.created_at),
    undoneAt: row.undone_at ?? null,
  };
}

function rowToRelation(row: any): AssistantObjectRelation {
  return {
    id: row.id,
    fromType: row.from_type,
    fromId: row.from_id,
    relationType: row.relation_type,
    toType: row.to_type,
    toId: row.to_id,
    sourceMessageId: row.source_message_id ?? null,
    createdAt: Number(row.created_at),
    undoneAt: row.undone_at ?? null,
  };
}

function readWith<T>(
  database: SQLiteDatabase | undefined,
  task: EventWrite<T>,
): Promise<T> {
  return database ? task(database) : withDatabaseConnection(task);
}

function writeWith<T>(
  database: SQLiteDatabase | undefined,
  task: EventWrite<T>,
): Promise<T> {
  return database ? task(database) : withExclusiveDatabaseTransaction(task);
}

export async function createEvent(input: {
  id?: string;
  title: string;
  currentState?: string;
  pinnedAt?: number | null;
  createdAt?: number;
}, database?: SQLiteDatabase): Promise<AssistantEvent> {
  const title = compact(input.title, 120);
  if (!title) throw new Error('事件标题不能为空');
  const currentState = compact(input.currentState ?? '', 600);
  const createdAt = input.createdAt ?? Date.now();
  const id = input.id ?? makeId('event', createdAt);
  return writeWith(database, async (connection) => {
    await connection.runAsync(
      `INSERT INTO assistant_events (
         id, title, current_state, status, pinned_at, revision, created_at, updated_at
       ) VALUES (?, ?, ?, 'active', ?, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      id, title, currentState, input.pinnedAt ?? null, createdAt, createdAt,
    );
    const row = await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', id);
    if (!row) throw new Error('事件创建失败');
    return rowToEvent(row);
  });
}

export function getEvent(id: string, database?: SQLiteDatabase): Promise<AssistantEvent | null> {
  return readWith(database, async (connection) => {
    const row = await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', id);
    return row ? rowToEvent(row) : null;
  });
}

export function listEvents(
  options: { status?: 'active' | 'closed'; limit?: number } = {},
  database?: SQLiteDatabase,
): Promise<AssistantEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  return readWith(database, async (connection) => {
    const rows = options.status
      ? await connection.getAllAsync<any>(
        `SELECT * FROM assistant_events WHERE status=?
         ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC, id DESC LIMIT ?`,
        options.status, limit,
      )
      : await connection.getAllAsync<any>(
        `SELECT * FROM assistant_events
         ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC, id DESC LIMIT ?`,
        limit,
      );
    return rows.map(rowToEvent);
  });
}

export function updateEventState(input: {
  eventId: string;
  currentState: string;
  expectedRevision?: number;
  updatedAt?: number;
}, database?: SQLiteDatabase): Promise<AssistantEvent | null> {
  const currentState = compact(input.currentState, 600);
  if (!currentState) throw new Error('事件当前状态不能为空');
  const updatedAt = input.updatedAt ?? Date.now();
  return writeWith(database, async (connection) => {
    const current = await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId);
    if (!current) return null;
    if (input.expectedRevision !== undefined && Number(current.revision) !== input.expectedRevision) return null;
    if (current.current_state === currentState) return rowToEvent(current);
    const result = await connection.runAsync(
      `UPDATE assistant_events
       SET current_state=?, revision=revision+1, updated_at=?
       WHERE id=? AND revision=?`,
      currentState, updatedAt, input.eventId, current.revision,
    );
    if (result.changes === 0) return null;
    return rowToEvent(await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId));
  });
}

export function appendEventUpdate(input: {
  id?: string;
  eventId: string;
  content: string;
  occurredAt?: number;
  sourceMessageId?: string | null;
  stableKey: string;
}, database?: SQLiteDatabase): Promise<AssistantEventUpdate> {
  const content = compact(input.content, 800);
  const stableKey = compact(input.stableKey, 200);
  if (!content || !stableKey) throw new Error('事件进展内容和稳定键不能为空');
  const occurredAt = input.occurredAt ?? Date.now();
  const id = input.id ?? makeId('event-update', occurredAt);
  return writeWith(database, async (connection) => {
    const duplicate = await connection.getFirstAsync<any>(
      'SELECT * FROM assistant_event_updates WHERE stable_key=?', stableKey,
    );
    if (duplicate) return rowToUpdate(duplicate);
    const event = await connection.getFirstAsync<any>('SELECT revision FROM assistant_events WHERE id=?', input.eventId);
    if (!event) throw new Error('找不到对应事件');
    await connection.runAsync(
      `INSERT INTO assistant_event_updates (
         id, event_id, content, occurred_at, source_message_id, stable_key, created_at, undone_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      id, input.eventId, content, occurredAt, input.sourceMessageId ?? null, stableKey, occurredAt,
    );
    await connection.runAsync(
      'UPDATE assistant_events SET revision=revision+1, updated_at=? WHERE id=?',
      occurredAt, input.eventId,
    );
    return rowToUpdate(await connection.getFirstAsync<any>('SELECT * FROM assistant_event_updates WHERE id=?', id));
  });
}

export function listEventUpdates(
  eventId: string,
  database?: SQLiteDatabase,
): Promise<AssistantEventUpdate[]> {
  return readWith(database, async (connection) => {
    const rows = await connection.getAllAsync<any>(
      `SELECT * FROM assistant_event_updates
       WHERE event_id=? AND undone_at IS NULL
       ORDER BY occurred_at DESC, id DESC`,
      eventId,
    );
    return rows.map(rowToUpdate);
  });
}

export function renameEvent(input: {
  eventId: string;
  title: string;
  expectedRevision?: number;
  updatedAt?: number;
}, database?: SQLiteDatabase): Promise<AssistantEvent | null> {
  const title = compact(input.title, 120);
  if (!title) throw new Error('事件标题不能为空');
  const updatedAt = input.updatedAt ?? Date.now();
  return writeWith(database, async (connection) => {
    const current = await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId);
    if (!current) return null;
    if (input.expectedRevision !== undefined && Number(current.revision) !== input.expectedRevision) return null;
    if (current.title === title) return rowToEvent(current);
    await connection.runAsync(
      `INSERT OR IGNORE INTO assistant_event_aliases (id, event_id, alias, created_at)
       VALUES (?, ?, ?, ?)`,
      makeId('event-alias', updatedAt), input.eventId, current.title, updatedAt,
    );
    const result = await connection.runAsync(
      'UPDATE assistant_events SET title=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?',
      title, updatedAt, input.eventId, current.revision,
    );
    if (result.changes === 0) return null;
    return rowToEvent(await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId));
  });
}

export function listEventAliases(eventId: string, database?: SQLiteDatabase): Promise<string[]> {
  return readWith(database, async (connection) => {
    const rows = await connection.getAllAsync<{ alias: string }>(
      'SELECT alias FROM assistant_event_aliases WHERE event_id=? ORDER BY created_at, id', eventId,
    );
    return rows.map(row => row.alias);
  });
}

export function setEventPinned(input: {
  eventId: string;
  pinned: boolean;
  expectedRevision?: number;
  updatedAt?: number;
}, database?: SQLiteDatabase): Promise<AssistantEvent | null> {
  const updatedAt = input.updatedAt ?? Date.now();
  return writeWith(database, async (connection) => {
    const current = await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId);
    if (!current) return null;
    if (input.expectedRevision !== undefined && Number(current.revision) !== input.expectedRevision) return null;
    const pinnedAt = input.pinned ? updatedAt : null;
    if ((current.pinned_at ?? null) === pinnedAt || (!input.pinned && current.pinned_at === null)) {
      return rowToEvent(current);
    }
    const result = await connection.runAsync(
      'UPDATE assistant_events SET pinned_at=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?',
      pinnedAt, updatedAt, input.eventId, current.revision,
    );
    if (result.changes === 0) return null;
    return rowToEvent(await connection.getFirstAsync<any>('SELECT * FROM assistant_events WHERE id=?', input.eventId));
  });
}

export function linkObjects(input: {
  id?: string;
  fromType: AssistantObjectType;
  fromId: string;
  relationType: AssistantRelationType;
  toType: AssistantObjectType;
  toId: string;
  sourceMessageId?: string | null;
  createdAt?: number;
}, database?: SQLiteDatabase): Promise<AssistantObjectRelation> {
  const createdAt = input.createdAt ?? Date.now();
  const id = input.id ?? makeId('relation', createdAt);
  return writeWith(database, async (connection) => {
    await connection.runAsync(
      `INSERT OR IGNORE INTO assistant_object_relations (
         id, from_type, from_id, relation_type, to_type, to_id,
         source_message_id, created_at, undone_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      id, input.fromType, input.fromId, input.relationType, input.toType, input.toId,
      input.sourceMessageId ?? null, createdAt,
    );
    const row = await connection.getFirstAsync<any>(
      `SELECT * FROM assistant_object_relations
       WHERE from_type=? AND from_id=? AND relation_type=? AND to_type=? AND to_id=?`,
      input.fromType, input.fromId, input.relationType, input.toType, input.toId,
    );
    return rowToRelation(row);
  });
}

export function countEventSourceMessages(eventId: string, database?: SQLiteDatabase): Promise<number> {
  return readWith(database, async (connection) => {
    const row = await connection.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM assistant_object_relations
       WHERE from_type='message' AND relation_type='source'
         AND to_type='event' AND to_id=? AND undone_at IS NULL`,
      eventId,
    );
    return Number(row?.count ?? 0);
  });
}

