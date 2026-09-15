import type { SQLiteDatabase } from 'expo-sqlite';

import { withDatabaseConnection, withExclusiveDatabaseTransaction } from '../db';
import { appendEventUpdate, createEvent, linkObjects } from './event-store';

type LegacyTopicRow = {
  topic: string;
  pinned_at: number | null;
};

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

function migrationKey(topic: string): string {
  return `legacy-topic-v1:${topic}`;
}

async function listPendingTopics(limit: number): Promise<LegacyTopicRow[]> {
  return withDatabaseConnection(database => database.getAllAsync<LegacyTopicRow>(
    `SELECT DISTINCT e.topic, p.pinned_at
     FROM entries e
     LEFT JOIN topic_preferences p ON p.topic=e.topic
     LEFT JOIN assistant_migrations m ON m.migration_key=('legacy-topic-v1:' || e.topic)
     WHERE e.topic IS NOT NULL AND TRIM(e.topic) != '' AND m.migration_key IS NULL
     ORDER BY e.topic ASC
     LIMIT ?`,
    limit,
  ));
}

async function migrateTopic(topicRow: LegacyTopicRow): Promise<boolean> {
  return withExclusiveDatabaseTransaction(async (database: SQLiteDatabase) => {
    const key = migrationKey(topicRow.topic);
    const completed = await database.getFirstAsync(
      'SELECT migration_key FROM assistant_migrations WHERE migration_key=?', key,
    );
    if (completed) return false;

    const latest = await database.getFirstAsync<any>(
      `SELECT * FROM entries WHERE topic=?
       ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
      topicRow.topic,
    );
    if (!latest) return false;

    const eventId = `legacy-event-${stableHash(topicRow.topic)}`;
    const event = await createEvent({
      id: eventId,
      title: topicRow.topic,
      currentState: latest.summary || latest.raw_text,
      pinnedAt: topicRow.pinned_at,
      createdAt: Number(latest.created_at),
    }, database);

    const latestMessage = await database.getFirstAsync<{ id: string }>(
      'SELECT id FROM assistant_messages WHERE legacy_entry_id=? LIMIT 1', latest.id,
    );
    await appendEventUpdate({
      id: `legacy-update-${stableHash(topicRow.topic)}`,
      eventId: event.id,
      content: latest.summary || latest.raw_text,
      occurredAt: Number(latest.updated_at ?? latest.created_at),
      sourceMessageId: latestMessage?.id ?? null,
      stableKey: `${key}:initial-update`,
    }, database);

    const messages = await database.getAllAsync<{ id: string; created_at: number }>(
      `SELECT m.id, m.created_at
       FROM assistant_messages m
       JOIN entries e ON e.id=m.legacy_entry_id
       WHERE e.topic=?
       ORDER BY m.created_at, m.id`,
      topicRow.topic,
    );
    for (const message of messages) {
      await linkObjects({
        id: `legacy-source-${stableHash(`${topicRow.topic}:${message.id}`)}`,
        fromType: 'message',
        fromId: message.id,
        relationType: 'source',
        toType: 'event',
        toId: event.id,
        sourceMessageId: message.id,
        createdAt: Number(message.created_at),
      }, database);
    }

    await database.runAsync(
      'INSERT INTO assistant_migrations (migration_key, completed_at) VALUES (?, ?)',
      key, Date.now(),
    );
    return true;
  });
}

export async function migrateLegacyTopicsToEvents(limit = 25): Promise<number> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const topics = await listPendingTopics(safeLimit);
  let migrated = 0;
  for (const topic of topics) {
    if (await migrateTopic(topic)) migrated += 1;
  }
  return migrated;
}
