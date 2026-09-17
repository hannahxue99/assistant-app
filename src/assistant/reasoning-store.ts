import type { SQLiteDatabase } from 'expo-sqlite';

import { withDatabaseConnection } from '../db';

export interface AssistantReasoning {
  requestId: string;
  content: string;
  startedAt: number;
  completedAt: number;
  createdAt: number;
}

function rowToReasoning(row: any): AssistantReasoning {
  return {
    requestId: row.request_id,
    content: row.content,
    startedAt: Number(row.started_at),
    completedAt: Number(row.completed_at),
    createdAt: Number(row.created_at),
  };
}

export async function saveAssistantReasoningWithDatabase(
  database: SQLiteDatabase,
  input: AssistantReasoning,
): Promise<void> {
  const content = input.content.trim();
  if (!content) return;
  await database.runAsync(
    `INSERT INTO assistant_reasoning (request_id, content, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(request_id) DO UPDATE SET
       content=excluded.content,
       started_at=excluded.started_at,
       completed_at=excluded.completed_at`,
    input.requestId,
    content,
    input.startedAt,
    Math.max(input.startedAt, input.completedAt),
    input.createdAt,
  );
}

export async function getAssistantReasoning(requestId: string): Promise<AssistantReasoning | null> {
  return withDatabaseConnection(async (database) => {
    const row = await database.getFirstAsync<any>(
      'SELECT * FROM assistant_reasoning WHERE request_id=?',
      requestId,
    );
    return row ? rowToReasoning(row) : null;
  });
}
