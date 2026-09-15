import type { SQLiteDatabase } from 'expo-sqlite';

import { withDatabaseConnection, withExclusiveDatabaseTransaction } from '../db';
import type { LegacyBackupEnvelope } from '../engine/legacy-backup';
import { legacyEntryFingerprint } from '../engine/legacy-backup';
import type { Entry } from '../types';
import { stableLocalHash } from './stable-id';

export interface LegacyImportPreview {
  conversations: number;
  todos: number;
  events: number;
  duplicates: number;
}

export interface LegacyImportResult extends LegacyImportPreview {
  affectedEntries: Entry[];
}

type LocalEntryRow = {
  id: string;
  raw_text: string;
  kind: Entry['kind'];
  summary: string;
  due_at: number | null;
  topic: string | null;
  tags: string;
  created_at: number;
  done: 0 | 1;
};

type ResolvedLegacyEntry = {
  incoming: Entry;
  entryId: string;
  existsLocally: boolean;
  messageId: string | null;
  updateExists: boolean;
};

function safeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowFingerprint(row: LocalEntryRow): string {
  return legacyEntryFingerprint({
    rawText: row.raw_text,
    kind: row.kind,
    summary: row.summary,
    dueAt: row.due_at,
    topic: typeof row.topic === 'string' && row.topic.trim() ? row.topic.trim() : null,
    tags: safeStringArray(row.tags),
    createdAt: Number(row.created_at),
    done: row.done,
  });
}

async function resolveEntries(
  database: SQLiteDatabase,
  envelope: LegacyBackupEnvelope,
): Promise<ResolvedLegacyEntry[]> {
  const [localRows, messageRows, updateRows] = await Promise.all([
    database.getAllAsync<LocalEntryRow>(
      'SELECT id,raw_text,kind,summary,due_at,topic,tags,created_at,done FROM entries',
    ),
    database.getAllAsync<{ id: string; legacy_entry_id: string }>(
      'SELECT id,legacy_entry_id FROM assistant_messages WHERE legacy_entry_id IS NOT NULL',
    ),
    database.getAllAsync<{ stable_key: string }>(
      "SELECT stable_key FROM assistant_event_updates WHERE stable_key LIKE 'legacy-import:%'",
    ),
  ]);
  const localById = new Map(localRows.map(row => [row.id, row]));
  const localByFingerprint = new Map(localRows.map(row => [rowFingerprint(row), row]));
  const messageByEntryId = new Map(messageRows.map(row => [row.legacy_entry_id, row.id]));
  const updateKeys = new Set(updateRows.map(row => row.stable_key));

  return envelope.entries.map((incoming) => {
    const fingerprint = legacyEntryFingerprint(incoming);
    const local = localById.get(incoming.id) ?? localByFingerprint.get(fingerprint) ?? null;
    const entryId = local?.id ?? incoming.id;
    return {
      incoming,
      entryId,
      existsLocally: !!local,
      messageId: messageByEntryId.get(entryId) ?? null,
      updateExists: updateKeys.has(`legacy-import:${fingerprint}`),
    };
  });
}

function summarizeResolved(
  resolved: ResolvedLegacyEntry[],
  duplicateCount: number,
): LegacyImportPreview {
  const eventTopics = new Set(
    resolved
      .filter(item => item.incoming.topic && !item.updateExists)
      .map(item => item.incoming.topic!),
  );
  return {
    conversations: resolved.filter(item => !item.messageId).length,
    todos: resolved.filter(item => item.incoming.kind === 'task' && !item.existsLocally).length,
    events: eventTopics.size,
    duplicates: duplicateCount + resolved.filter(item => item.existsLocally).length,
  };
}

export function previewLegacyImport(envelope: LegacyBackupEnvelope): Promise<LegacyImportPreview> {
  return withDatabaseConnection(async (database) => summarizeResolved(
    await resolveEntries(database, envelope),
    envelope.duplicateCount,
  ));
}

async function insertEntry(database: SQLiteDatabase, entry: Entry): Promise<void> {
  await database.runAsync(
    `INSERT INTO entries (
       id, raw_text, kind, summary, due_at, remind_at, topic, tags, persons,
       parse_status, parse_source, corrected_from, created_at, updated_at, revision_at,
       done, done_at, source, time_precision
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id, entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.remindAt,
    entry.topic, JSON.stringify(entry.tags), JSON.stringify(entry.persons),
    entry.parseStatus, entry.parseSource, entry.correctedFrom, entry.createdAt,
    entry.updatedAt, entry.revisionAt, entry.done, entry.doneAt, entry.source,
    entry.timePrecision ?? 'date',
  );
  await database.runAsync(
    'INSERT INTO entries_fts (entry_id, summary, raw_text, tags) VALUES (?, ?, ?, ?)',
    entry.id, entry.summary, entry.rawText, entry.tags.join(' '),
  );
}

async function ensureLegacySegment(
  database: SQLiteDatabase,
  entries: ResolvedLegacyEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const firstAt = Math.min(...entries.map(item => item.incoming.createdAt));
  const lastAt = Math.max(...entries.map(item => item.incoming.createdAt));
  await database.runAsync(
    `INSERT OR IGNORE INTO conversation_segments
     (id, summary, status, started_at, ended_at, updated_at)
     VALUES ('legacy-history', '', 'closed', ?, ?, ?)`,
    firstAt, lastAt, lastAt,
  );
  await database.runAsync(
    `UPDATE conversation_segments
     SET started_at=MIN(started_at, ?), ended_at=MAX(COALESCE(ended_at, ?), ?), updated_at=MAX(updated_at, ?)
     WHERE id='legacy-history'`,
    firstAt, lastAt, lastAt, lastAt,
  );
}

async function resolveEvent(
  database: SQLiteDatabase,
  topic: string,
  currentState: string,
  firstAt: number,
): Promise<{ id: string; existed: boolean; updatedAt: number }> {
  const deterministicId = `legacy-event-${stableLocalHash(topic)}`;
  const byId = await database.getFirstAsync<{ id: string; updated_at: number }>(
    'SELECT id,updated_at FROM assistant_events WHERE id=?', deterministicId,
  );
  const existing = byId ?? await database.getFirstAsync<{ id: string; updated_at: number }>(
    'SELECT id,updated_at FROM assistant_events WHERE title=? COLLATE NOCASE ORDER BY created_at LIMIT 1', topic,
  );
  if (existing) return { id: existing.id, existed: true, updatedAt: Number(existing.updated_at) };
  await database.runAsync(
    `INSERT INTO assistant_events (
       id, title, current_state, status, pinned_at, revision, created_at, updated_at
     ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
    deterministicId, topic, currentState, firstAt, firstAt,
  );
  return { id: deterministicId, existed: false, updatedAt: firstAt };
}

async function projectEvents(
  database: SQLiteDatabase,
  resolved: ResolvedLegacyEntry[],
): Promise<void> {
  const byTopic = new Map<string, ResolvedLegacyEntry[]>();
  for (const item of resolved) {
    const topic = item.incoming.topic?.trim();
    if (!topic) continue;
    const group = byTopic.get(topic) ?? [];
    group.push(item);
    byTopic.set(topic, group);
  }

  for (const [topic, items] of byTopic) {
    const sorted = [...items].sort((left, right) => (
      left.incoming.createdAt - right.incoming.createdAt || left.entryId.localeCompare(right.entryId)
    ));
    const latest = sorted[sorted.length - 1].incoming;
    const event = await resolveEvent(database, topic, latest.summary, sorted[0].incoming.createdAt);

    for (const item of sorted) {
      const fingerprint = legacyEntryFingerprint(item.incoming);
      const message = await database.getFirstAsync<{ id: string }>(
        'SELECT id FROM assistant_messages WHERE legacy_entry_id=?', item.entryId,
      );
      if (!message) throw new Error('旧记录消息投影缺失');
      const updateKey = `legacy-import:${fingerprint}`;
      const updateId = `legacy-update-${stableLocalHash(`${event.id}:${fingerprint}`)}`;
      const inserted = await database.runAsync(
        `INSERT OR IGNORE INTO assistant_event_updates (
           id, event_id, content, occurred_at, source_message_id, stable_key, created_at, undone_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        updateId, event.id, item.incoming.summary, item.incoming.createdAt,
        message.id, updateKey, item.incoming.createdAt,
      );
      if (inserted.changes > 0) {
        await database.runAsync(
          'UPDATE assistant_events SET revision=revision+1, updated_at=MAX(updated_at, ?) WHERE id=?',
          item.incoming.createdAt, event.id,
        );
      }
      await database.runAsync(
        `INSERT OR IGNORE INTO assistant_object_relations (
           id, from_type, from_id, relation_type, to_type, to_id, source_message_id, created_at, undone_at
         ) VALUES (?, 'message', ?, 'source', 'event', ?, ?, ?, NULL)`,
        `legacy-source-${stableLocalHash(`${message.id}:${event.id}`)}`,
        message.id, event.id, message.id, item.incoming.createdAt,
      );
      if (item.incoming.kind === 'task') {
        await database.runAsync(
          `INSERT OR IGNORE INTO assistant_object_relations (
             id, from_type, from_id, relation_type, to_type, to_id, source_message_id, created_at, undone_at
           ) VALUES (?, 'todo', ?, 'belongs_to', 'event', ?, ?, ?, NULL)`,
          `legacy-todo-${stableLocalHash(`${item.entryId}:${event.id}`)}`,
          item.entryId, event.id, message.id, item.incoming.createdAt,
        );
      }
    }

    if (!event.existed || latest.createdAt >= event.updatedAt) {
      await database.runAsync(
        `UPDATE assistant_events
         SET current_state=?, revision=revision+CASE WHEN current_state=? THEN 0 ELSE 1 END,
             updated_at=MAX(updated_at, ?)
         WHERE id=?`,
        latest.summary, latest.summary, latest.createdAt, event.id,
      );
    }
  }
}

/** Import a legacy human-readable export without invoking the assistant model. */
export function importLegacyExport(envelope: LegacyBackupEnvelope): Promise<LegacyImportResult> {
  return withExclusiveDatabaseTransaction(async (database) => {
    const resolved = await resolveEntries(database, envelope);
    const preview = summarizeResolved(resolved, envelope.duplicateCount);
    const affectedEntries: Entry[] = [];
    const importedAt = Date.now();

    for (const item of resolved) {
      if (item.existsLocally) continue;
      await insertEntry(database, item.incoming);
      affectedEntries.push(item.incoming);
      if (item.incoming.kind === 'task') {
        await database.runAsync(
          `INSERT INTO notification_sync_queue (entry_id, queued_at) VALUES (?, ?)
           ON CONFLICT(entry_id) DO UPDATE SET queued_at=excluded.queued_at`,
          item.incoming.id, importedAt,
        );
      }
    }

    await ensureLegacySegment(database, resolved);
    for (const item of resolved) {
      if (item.messageId) continue;
      const messageId = `legacy-${item.entryId}`;
      await database.runAsync(
        `INSERT OR IGNORE INTO assistant_messages (
           id, request_id, role, content, source, status, segment_id,
           legacy_entry_id, created_at, updated_at
         ) VALUES (?, ?, 'user', ?, 'legacy', 'saved', 'legacy-history', ?, ?, ?)`,
        messageId, messageId, item.incoming.rawText, item.entryId,
        item.incoming.createdAt, item.incoming.createdAt,
      );
    }

    await projectEvents(database, resolved);
    return { ...preview, affectedEntries };
  });
}
