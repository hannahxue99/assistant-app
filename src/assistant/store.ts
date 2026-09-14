import type { SQLiteDatabase } from 'expo-sqlite';

import {
  withDatabaseConnection,
  withExclusiveDatabaseTransaction,
} from '../db';
import type {
  AssistantMessage,
  AssistantMessageCursor,
  AssistantMessageSource,
  AssistantSegmentDecision,
  ConversationSegment,
} from './types';

export interface AssistantRequestState {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage | null;
}

type UserTurnInput = {
  requestId: string;
  content: string;
  source: Extract<AssistantMessageSource, 'text' | 'voice' | 'contextual'>;
  createdAt?: number;
};

type CompleteTurnInput = {
  requestId: string;
  reply: string;
  segment: AssistantSegmentDecision;
  createdAt?: number;
};

function makeId(prefix: string, now: number): string {
  return `${prefix}-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToMessage(row: any): AssistantMessage {
  return {
    id: row.id,
    requestId: row.request_id,
    role: row.role,
    content: row.content,
    source: row.source,
    status: row.status,
    segmentId: row.segment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legacyEntryId: row.legacy_entry_id ?? null,
  };
}

function rowToSegment(row: any): ConversationSegment {
  return {
    id: row.id,
    summary: row.summary,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    updatedAt: row.updated_at,
  };
}

async function currentSegment(txn: SQLiteDatabase, now: number): Promise<ConversationSegment> {
  const existing = await txn.getFirstAsync<any>(
    "SELECT * FROM conversation_segments WHERE status='current' LIMIT 1",
  );
  if (existing) return rowToSegment(existing);
  const id = makeId('segment', now);
  await txn.runAsync(
    `INSERT INTO conversation_segments (id, summary, status, started_at, ended_at, updated_at)
     VALUES (?, '', 'current', ?, NULL, ?)`,
    id, now, now,
  );
  return { id, summary: '', status: 'current', startedAt: now, endedAt: null, updatedAt: now };
}

export async function saveUserTurn(input: UserTurnInput): Promise<AssistantMessage> {
  const content = input.content.trim();
  if (!content) throw new Error('消息不能为空');
  return withExclusiveDatabaseTransaction(async (txn) => {
    const duplicate = await txn.getFirstAsync<any>(
      "SELECT * FROM assistant_messages WHERE request_id=? AND role='user'",
      input.requestId,
    );
    if (duplicate) return rowToMessage(duplicate);

    const createdAt = input.createdAt ?? Date.now();
    const segment = await currentSegment(txn, createdAt);
    const messageId = makeId('message', createdAt);
    await txn.runAsync(
      `INSERT INTO assistant_messages (
         id, request_id, role, content, source, status, segment_id,
         legacy_entry_id, created_at, updated_at
       ) VALUES (?, ?, 'user', ?, ?, 'sending', ?, NULL, ?, ?)`,
      messageId, input.requestId, content, input.source, segment.id, createdAt, createdAt,
    );
    await txn.runAsync(
      `INSERT INTO assistant_requests (
         id, user_message_id, status, error_code, attempt_count, created_at, updated_at
       ) VALUES (?, ?, 'pending', NULL, 1, ?, ?)`,
      input.requestId, messageId, createdAt, createdAt,
    );
    const row = await txn.getFirstAsync<any>('SELECT * FROM assistant_messages WHERE id=?', messageId);
    return rowToMessage(row);
  });
}

export async function beginRetry(requestId: string, updatedAt = Date.now()): Promise<AssistantMessage> {
  return withExclusiveDatabaseTransaction(async (txn) => {
    const row = await txn.getFirstAsync<any>(
      "SELECT * FROM assistant_messages WHERE request_id=? AND role='user'",
      requestId,
    );
    if (!row) throw new Error('找不到可重试的消息');
    const request = await txn.getFirstAsync<any>('SELECT * FROM assistant_requests WHERE id=?', requestId);
    if (request?.status === 'succeeded') return rowToMessage(row);
    await txn.runAsync(
      `UPDATE assistant_requests
       SET status='pending', error_code=NULL, attempt_count=attempt_count+1, updated_at=?
       WHERE id=?`,
      updatedAt, requestId,
    );
    await txn.runAsync(
      "UPDATE assistant_messages SET status='sending', updated_at=? WHERE request_id=? AND role='user'",
      updatedAt, requestId,
    );
    return rowToMessage(await txn.getFirstAsync<any>('SELECT * FROM assistant_messages WHERE id=?', row.id));
  });
}

export async function completeTurn(input: CompleteTurnInput): Promise<AssistantMessage> {
  const reply = input.reply.trim();
  if (!reply) throw new Error('助手回复不能为空');
  return withExclusiveDatabaseTransaction(async (txn) => {
    const existing = await txn.getFirstAsync<any>(
      "SELECT * FROM assistant_messages WHERE request_id=? AND role='assistant'",
      input.requestId,
    );
    if (existing) return rowToMessage(existing);

    const request = await txn.getFirstAsync<any>('SELECT * FROM assistant_requests WHERE id=?', input.requestId);
    if (!request) throw new Error('找不到对应请求');
    const userRow = await txn.getFirstAsync<any>('SELECT * FROM assistant_messages WHERE id=?', request.user_message_id);
    if (!userRow) throw new Error('找不到对应用户消息');

    const createdAt = input.createdAt ?? Date.now();
    let replySegmentId = userRow.segment_id;
    if (input.segment.action === 'split_before_user') {
      const oldCount = await txn.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM assistant_messages WHERE segment_id=? AND id!=?',
        userRow.segment_id, userRow.id,
      );
      if ((oldCount?.count ?? 0) > 0) {
        const newSegmentId = makeId('segment', userRow.created_at);
        await txn.runAsync(
          `UPDATE conversation_segments
           SET status='closed', summary=COALESCE(NULLIF(?, ''), summary), ended_at=?, updated_at=?
           WHERE id=?`,
          input.segment.previousSummary?.trim() ?? '', userRow.created_at - 1, createdAt, userRow.segment_id,
        );
        await txn.runAsync(
          `INSERT INTO conversation_segments (id, summary, status, started_at, ended_at, updated_at)
           VALUES (?, ?, 'current', ?, NULL, ?)`,
          newSegmentId, input.segment.summary?.trim() ?? '', userRow.created_at, createdAt,
        );
        await txn.runAsync('UPDATE assistant_messages SET segment_id=? WHERE id=?', newSegmentId, userRow.id);
        replySegmentId = newSegmentId;
      }
    } else if (input.segment.summary?.trim()) {
      await txn.runAsync(
        'UPDATE conversation_segments SET summary=?, updated_at=? WHERE id=?',
        input.segment.summary.trim(), createdAt, userRow.segment_id,
      );
    }

    const replyId = makeId('message', createdAt);
    await txn.runAsync(
      `INSERT INTO assistant_messages (
         id, request_id, role, content, source, status, segment_id,
         legacy_entry_id, created_at, updated_at
       ) VALUES (?, ?, 'assistant', ?, 'assistant', 'saved', ?, NULL, ?, ?)`,
      replyId, input.requestId, reply, replySegmentId, createdAt, createdAt,
    );
    await txn.runAsync(
      "UPDATE assistant_messages SET status='saved', updated_at=? WHERE id=?",
      createdAt, userRow.id,
    );
    await txn.runAsync(
      "UPDATE assistant_requests SET status='succeeded', error_code=NULL, updated_at=? WHERE id=?",
      createdAt, input.requestId,
    );
    return rowToMessage(await txn.getFirstAsync<any>('SELECT * FROM assistant_messages WHERE id=?', replyId));
  });
}

export async function failTurn(requestId: string, errorCode: string, updatedAt = Date.now()): Promise<void> {
  await withExclusiveDatabaseTransaction(async (txn) => {
    const request = await txn.getFirstAsync<any>('SELECT status FROM assistant_requests WHERE id=?', requestId);
    if (!request || request.status === 'succeeded') return;
    await txn.runAsync(
      "UPDATE assistant_requests SET status='failed', error_code=?, updated_at=? WHERE id=?",
      errorCode, updatedAt, requestId,
    );
    await txn.runAsync(
      "UPDATE assistant_messages SET status='failed', updated_at=? WHERE request_id=? AND role='user'",
      updatedAt, requestId,
    );
  });
}

export async function getMessage(id: string): Promise<AssistantMessage | null> {
  return withDatabaseConnection(async (database) => {
    const row = await database.getFirstAsync<any>('SELECT * FROM assistant_messages WHERE id=?', id);
    return row ? rowToMessage(row) : null;
  });
}

export async function getRequestState(requestId: string): Promise<AssistantRequestState | null> {
  return withDatabaseConnection(async (database) => {
    const request = await database.getFirstAsync<any>('SELECT * FROM assistant_requests WHERE id=?', requestId);
    if (!request) return null;
    const userRow = await database.getFirstAsync<any>(
      "SELECT * FROM assistant_messages WHERE request_id=? AND role='user'",
      requestId,
    );
    if (!userRow) return null;
    const assistantRow = await database.getFirstAsync<any>(
      "SELECT * FROM assistant_messages WHERE request_id=? AND role='assistant'",
      requestId,
    );
    return {
      id: request.id,
      status: request.status,
      userMessage: rowToMessage(userRow),
      assistantMessage: assistantRow ? rowToMessage(assistantRow) : null,
    };
  });
}

export async function listMessages(options: {
  limit?: number;
  before?: AssistantMessageCursor;
} = {}): Promise<AssistantMessage[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  return withDatabaseConnection(async (database) => {
    const rows = options.before
      ? await database.getAllAsync<any>(
        `SELECT * FROM assistant_messages
         WHERE created_at < ? OR (created_at = ? AND id < ?)
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        options.before.createdAt, options.before.createdAt, options.before.id, limit,
      )
      : await database.getAllAsync<any>(
        'SELECT * FROM assistant_messages ORDER BY created_at DESC, id DESC LIMIT ?',
        limit,
      );
    return rows.reverse().map(rowToMessage);
  });
}

export async function getCurrentSegment(): Promise<ConversationSegment | null> {
  return withDatabaseConnection(async (database) => {
    const row = await database.getFirstAsync<any>(
      "SELECT * FROM conversation_segments WHERE status='current' LIMIT 1",
    );
    return row ? rowToSegment(row) : null;
  });
}

export async function listClosedSegments(limit = 100): Promise<ConversationSegment[]> {
  return withDatabaseConnection(async (database) => {
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM conversation_segments
       WHERE status='closed' AND summary!=''
       ORDER BY updated_at DESC LIMIT ?`,
      Math.max(1, Math.min(limit, 500)),
    );
    return rows.map(rowToSegment);
  });
}

/**
 * 将旧原声投影进连续历史。返回本批实际新增数量；可重复调用、可中断续跑。
 */
export async function projectLegacyEntries(limit = 500): Promise<number> {
  return withExclusiveDatabaseTransaction(async (txn) => {
    const rows = await txn.getAllAsync<any>(
      `SELECT e.id, e.raw_text, e.source, e.created_at
       FROM entries e
       LEFT JOIN assistant_messages m ON m.legacy_entry_id=e.id
       WHERE m.id IS NULL
       ORDER BY e.created_at ASC, e.id ASC
       LIMIT ?`,
      Math.max(1, Math.min(limit, 1000)),
    );
    if (rows.length === 0) return 0;
    const legacySegmentId = 'legacy-history';
    const firstAt = rows[0].created_at;
    const lastAt = rows[rows.length - 1].created_at;
    await txn.runAsync(
      `INSERT OR IGNORE INTO conversation_segments
       (id, summary, status, started_at, ended_at, updated_at)
       VALUES (?, '', 'closed', ?, ?, ?)`,
      legacySegmentId, firstAt, lastAt, lastAt,
    );
    let inserted = 0;
    for (const row of rows) {
      const result = await txn.runAsync(
        `INSERT OR IGNORE INTO assistant_messages (
           id, request_id, role, content, source, status, segment_id,
           legacy_entry_id, created_at, updated_at
         ) VALUES (?, ?, 'user', ?, 'legacy', 'saved', ?, ?, ?, ?)`,
        `legacy-${row.id}`, `legacy-${row.id}`, row.raw_text, legacySegmentId,
        row.id, row.created_at, row.created_at,
      );
      inserted += result.changes;
    }
    return inserted;
  });
}
