import type { SQLiteDatabase } from 'expo-sqlite';

import { withDatabaseConnection, withExclusiveDatabaseTransaction } from '../db';
import { normalizeMemoryContent } from './memory-policy';
import type {
  AssistantMemory,
  AssistantMemoryAdmissionBasis,
  AssistantMemoryCategory,
  AssistantMemorySensitivity,
  AssistantMemorySource,
} from './memory-types';

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

export function deterministicMemoryId(scope: string, key: string): string {
  return `assistant-memory-${stableHash(`${scope}:${key}`)}`;
}

export function rowToMemory(row: any): AssistantMemory {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    normalizedContent: row.normalized_content,
    status: row.status,
    sensitivity: row.sensitivity,
    admissionBasis: row.admission_basis,
    supersededById: row.superseded_by_id ?? null,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    activatedAt: row.activated_at ?? null,
    supersededAt: row.superseded_at ?? null,
    forgottenAt: row.forgotten_at ?? null,
  };
}

function rowToSource(row: any): AssistantMemorySource {
  return {
    id: row.id,
    memoryId: row.memory_id,
    sourceMessageId: row.source_message_id ?? null,
    evidence: row.evidence,
    createdAt: Number(row.created_at),
  };
}

export async function getMemoryWithDatabase(
  database: SQLiteDatabase,
  id: string,
): Promise<AssistantMemory | null> {
  const row = await database.getFirstAsync<any>('SELECT * FROM assistant_memories WHERE id=?', id);
  return row ? rowToMemory(row) : null;
}

export function getMemory(id: string): Promise<AssistantMemory | null> {
  return withDatabaseConnection(database => getMemoryWithDatabase(database, id));
}

export function listActiveMemories(limit = 100): Promise<AssistantMemory[]> {
  return withDatabaseConnection(async (database) => {
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM assistant_memories WHERE status='active'
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      Math.max(1, Math.min(limit, 500)),
    );
    return rows.map(rowToMemory);
  });
}

export function listMemoryCandidates(limit = 100): Promise<AssistantMemory[]> {
  return withDatabaseConnection(async (database) => {
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM assistant_memories WHERE status='candidate'
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      Math.max(1, Math.min(limit, 500)),
    );
    return rows.map(rowToMemory);
  });
}

export function listMemoriesByIds(ids: string[]): Promise<AssistantMemory[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return Promise.resolve([]);
  return withDatabaseConnection(async (database) => {
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<any>(
      `SELECT * FROM assistant_memories WHERE id IN (${placeholders})`,
      ...uniqueIds,
    );
    const byId = new Map(rows.map(row => [row.id, rowToMemory(row)]));
    return uniqueIds.map(id => byId.get(id)).filter((memory): memory is AssistantMemory => Boolean(memory));
  });
}

export function listMemorySources(memoryId: string, database?: SQLiteDatabase): Promise<AssistantMemorySource[]> {
  const read = async (connection: SQLiteDatabase) => {
    const rows = await connection.getAllAsync<any>(
      'SELECT * FROM assistant_memory_sources WHERE memory_id=? ORDER BY created_at, id',
      memoryId,
    );
    return rows.map(rowToSource);
  };
  return database ? read(database) : withDatabaseConnection(read);
}

export async function createMemoryWithDatabase(database: SQLiteDatabase, input: {
  id: string;
  category: AssistantMemoryCategory;
  content: string;
  status: 'candidate' | 'active';
  sensitivity: AssistantMemorySensitivity;
  admissionBasis: AssistantMemoryAdmissionBasis;
  createdAt: number;
}): Promise<AssistantMemory> {
  const content = input.content.trim().replace(/\s+/g, ' ');
  const activatedAt = input.status === 'active' ? input.createdAt : null;
  await database.runAsync(
    `INSERT OR IGNORE INTO assistant_memories (
       id, category, content, normalized_content, status, sensitivity, admission_basis,
       superseded_by_id, revision, created_at, updated_at, activated_at, superseded_at, forgotten_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, NULL, NULL)`,
    input.id, input.category, content, normalizeMemoryContent(content), input.status,
    input.sensitivity, input.admissionBasis, input.createdAt, input.createdAt, activatedAt,
  );
  const memory = await getMemoryWithDatabase(database, input.id);
  if (!memory) throw new Error('记忆写入失败');
  return memory;
}

export async function addMemorySourceWithDatabase(database: SQLiteDatabase, input: {
  id: string;
  memoryId: string;
  sourceMessageId: string | null;
  evidence: string;
  createdAt: number;
}): Promise<AssistantMemorySource> {
  const evidence = input.evidence.trim().replace(/\s+/g, ' ');
  await database.runAsync(
    `INSERT OR IGNORE INTO assistant_memory_sources
     (id, memory_id, source_message_id, evidence, created_at) VALUES (?, ?, ?, ?, ?)`,
    input.id, input.memoryId, input.sourceMessageId, evidence, input.createdAt,
  );
  const row = await database.getFirstAsync<any>(
    input.sourceMessageId
      ? 'SELECT * FROM assistant_memory_sources WHERE memory_id=? AND source_message_id=?'
      : 'SELECT * FROM assistant_memory_sources WHERE id=? AND memory_id=?',
    input.sourceMessageId ? input.memoryId : input.id,
    input.sourceMessageId ? input.sourceMessageId : input.memoryId,
  );
  if (!row) throw new Error('记忆来源写入失败');
  return rowToSource(row);
}

export async function activateMemoryWithDatabase(database: SQLiteDatabase, input: {
  id: string;
  expectedRevision: number;
  admissionBasis: 'repeated' | 'confirmed';
  updatedAt: number;
}): Promise<AssistantMemory | null> {
  const result = await database.runAsync(
    `UPDATE assistant_memories
     SET status='active', admission_basis=?, revision=revision+1,
         activated_at=?, updated_at=?, forgotten_at=NULL
     WHERE id=? AND status='candidate' AND revision=?`,
    input.admissionBasis, input.updatedAt, input.updatedAt, input.id, input.expectedRevision,
  );
  return result.changes ? getMemoryWithDatabase(database, input.id) : null;
}

export async function supersedeMemoryWithDatabase(database: SQLiteDatabase, input: {
  id: string;
  expectedRevision: number;
  successorId: string;
  category: AssistantMemoryCategory;
  content: string;
  sensitivity: AssistantMemorySensitivity;
  admissionBasis: 'explicit' | 'manual_edit';
  updatedAt: number;
}): Promise<{ before: AssistantMemory; old: AssistantMemory; successor: AssistantMemory } | null> {
  const before = await getMemoryWithDatabase(database, input.id);
  if (!before || before.status !== 'active' || before.revision !== input.expectedRevision) return null;
  const successor = await createMemoryWithDatabase(database, {
    id: input.successorId,
    category: input.category,
    content: input.content,
    status: 'active',
    sensitivity: input.sensitivity,
    admissionBasis: input.admissionBasis,
    createdAt: input.updatedAt,
  });
  const result = await database.runAsync(
    `UPDATE assistant_memories
     SET status='superseded', superseded_by_id=?, revision=revision+1,
         superseded_at=?, updated_at=?
     WHERE id=? AND status='active' AND revision=?`,
    successor.id, input.updatedAt, input.updatedAt, input.id, input.expectedRevision,
  );
  if (!result.changes) {
    await database.runAsync('DELETE FROM assistant_memories WHERE id=?', successor.id);
    return null;
  }
  const old = await getMemoryWithDatabase(database, input.id);
  if (!old) throw new Error('旧记忆替代后丢失');
  return { before, old, successor };
}

export async function forgetMemoryWithDatabase(database: SQLiteDatabase, input: {
  id: string;
  expectedRevision: number;
  updatedAt: number;
}): Promise<{ before: AssistantMemory; after: AssistantMemory } | null> {
  const before = await getMemoryWithDatabase(database, input.id);
  if (!before || before.status !== 'active' || before.revision !== input.expectedRevision) return null;
  const result = await database.runAsync(
    `UPDATE assistant_memories SET status='forgotten', revision=revision+1,
       forgotten_at=?, updated_at=? WHERE id=? AND status='active' AND revision=?`,
    input.updatedAt, input.updatedAt, input.id, input.expectedRevision,
  );
  if (!result.changes) return null;
  const after = await getMemoryWithDatabase(database, input.id);
  if (!after) throw new Error('记忆忘记后丢失');
  return { before, after };
}

export type MemoryUiUndoToken =
  | { kind: 'edit'; before: AssistantMemory; oldAfter: AssistantMemory; successor: AssistantMemory }
  | { kind: 'forget'; before: AssistantMemory; after: AssistantMemory };

export function editMemory(input: {
  id: string;
  expectedRevision: number;
  content: string;
  updatedAt?: number;
}): Promise<{ memory: AssistantMemory; undo: MemoryUiUndoToken } | null> {
  const updatedAt = input.updatedAt ?? Date.now();
  return withExclusiveDatabaseTransaction(async (database) => {
    const current = await getMemoryWithDatabase(database, input.id);
    if (!current) return null;
    const result = await supersedeMemoryWithDatabase(database, {
      id: input.id,
      expectedRevision: input.expectedRevision,
      successorId: deterministicMemoryId(`manual:${input.id}:${updatedAt}`, input.content),
      category: current.category,
      content: input.content,
      sensitivity: current.sensitivity,
      admissionBasis: 'manual_edit',
      updatedAt,
    });
    return result
      ? { memory: result.successor, undo: { kind: 'edit', before: result.before, oldAfter: result.old, successor: result.successor } }
      : null;
  });
}

export function forgetMemory(input: {
  id: string;
  expectedRevision: number;
  updatedAt?: number;
}): Promise<{ undo: MemoryUiUndoToken } | null> {
  const updatedAt = input.updatedAt ?? Date.now();
  return withExclusiveDatabaseTransaction(async (database) => {
    const result = await forgetMemoryWithDatabase(database, { ...input, updatedAt });
    return result ? { undo: { kind: 'forget', ...result } } : null;
  });
}

export function undoMemoryUiAction(token: MemoryUiUndoToken, updatedAt = Date.now()): Promise<boolean> {
  return withExclusiveDatabaseTransaction(async (database) => {
    if (token.kind === 'forget') {
      const current = await getMemoryWithDatabase(database, token.after.id);
      if (!current || current.status !== 'forgotten' || current.revision !== token.after.revision) return false;
      const result = await database.runAsync(
        `UPDATE assistant_memories SET status='active', revision=revision+1,
           activated_at=?, forgotten_at=NULL, updated_at=? WHERE id=? AND revision=?`,
        updatedAt, updatedAt, current.id, current.revision,
      );
      return result.changes > 0;
    }

    const [old, successor] = await Promise.all([
      getMemoryWithDatabase(database, token.oldAfter.id),
      getMemoryWithDatabase(database, token.successor.id),
    ]);
    if (!old || !successor
      || old.status !== 'superseded' || old.revision !== token.oldAfter.revision
      || successor.status !== 'active' || successor.revision !== token.successor.revision) return false;
    await database.runAsync(
      `UPDATE assistant_memories SET status='forgotten', revision=revision+1,
       forgotten_at=?, updated_at=? WHERE id=? AND revision=?`,
      updatedAt, updatedAt, successor.id, successor.revision,
    );
    await database.runAsync(
      `UPDATE assistant_memories SET status='active', superseded_by_id=NULL,
       superseded_at=NULL, revision=revision+1, updated_at=? WHERE id=? AND revision=?`,
      updatedAt, old.id, old.revision,
    );
    return true;
  });
}
