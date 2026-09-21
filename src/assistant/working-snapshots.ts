import type { AssistantReadToolExecution, AssistantReadToolName, AssistantReadSet } from './data-tools';

export interface AssistantWorkingSnapshot {
  id: string;
  segmentId: string;
  toolName: Extract<AssistantReadToolName, 'get_event' | 'get_todo' | 'get_memory'>;
  objectId: string;
  result: Record<string, unknown>;
  readEventIds: string[];
  readTodoIds: string[];
  readMemoryIds: string[];
  eventRevisions: Record<string, number>;
  todoRevisions: Record<string, number>;
  memoryRevisions: Record<string, number>;
  readAt: number;
}

const runtime = globalThis as typeof globalThis & {
  __assistantWorkingSnapshotsV2?: Map<string, Map<string, AssistantWorkingSnapshot>>;
};
const snapshotsBySegment = runtime.__assistantWorkingSnapshotsV2 ??= new Map();

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function revisionOf(value: Record<string, unknown> | null): number | null {
  const revision = value?.revision;
  return typeof revision === 'number' && Number.isFinite(revision) ? revision : null;
}

function resultArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectValue).filter(Boolean) as Record<string, unknown>[] : [];
}

function snapshotFromExecution(
  segmentId: string,
  execution: AssistantReadToolExecution,
  readAt: number,
): AssistantWorkingSnapshot | null {
  if (execution.name !== 'get_event' && execution.name !== 'get_todo' && execution.name !== 'get_memory') return null;
  if (execution.result.found !== true) return null;

  const eventRevisions: Record<string, number> = {};
  const todoRevisions: Record<string, number> = {};
  const memoryRevisions: Record<string, number> = {};
  const event = objectValue(execution.result.event);
  const todo = objectValue(execution.result.todo);
  const memory = objectValue(execution.result.memory);
  const primary = execution.name === 'get_event' ? event : execution.name === 'get_todo' ? todo : memory;
  const primaryId = primary?.id;
  if (typeof primaryId !== 'string' || !primaryId) return null;

  for (const candidate of [event, ...resultArray(execution.result.events)]) {
    const id = candidate?.id;
    const revision = revisionOf(candidate);
    if (typeof id === 'string' && revision !== null) eventRevisions[id] = revision;
  }
  for (const candidate of [todo, ...resultArray(execution.result.todos)]) {
    const id = candidate?.id;
    const revision = revisionOf(candidate);
    if (typeof id === 'string' && revision !== null) todoRevisions[id] = revision;
  }
  for (const candidate of [memory]) {
    const id = candidate?.id;
    const revision = revisionOf(candidate);
    if (typeof id === 'string' && revision !== null) memoryRevisions[id] = revision;
  }
  if (!Object.keys(eventRevisions).length
    && !Object.keys(todoRevisions).length
    && !Object.keys(memoryRevisions).length) return null;

  return {
    id: `${execution.name}:${primaryId}`,
    segmentId,
    toolName: execution.name,
    objectId: primaryId,
    result: execution.result,
    readEventIds: [...execution.readEventIds],
    readTodoIds: [...execution.readTodoIds],
    readMemoryIds: [...execution.readMemoryIds],
    eventRevisions,
    todoRevisions,
    memoryRevisions,
    readAt,
  };
}

export function rememberAssistantWorkingSnapshots(
  segmentId: string,
  executions: AssistantReadToolExecution[],
  readAt = Date.now(),
): void {
  if (!segmentId) return;
  const segmentSnapshots = snapshotsBySegment.get(segmentId) ?? new Map<string, AssistantWorkingSnapshot>();
  for (const execution of executions) {
    const snapshot = snapshotFromExecution(segmentId, execution, readAt);
    if (snapshot) segmentSnapshots.set(snapshot.id, snapshot);
  }
  if (segmentSnapshots.size) snapshotsBySegment.set(segmentId, segmentSnapshots);
}

type DatabaseLike = {
  getAllAsync<T>(sql: string, ...args: any[]): Promise<T[]>;
};

async function validSnapshotsWithDatabase(
  database: DatabaseLike,
  snapshots: AssistantWorkingSnapshot[],
): Promise<AssistantWorkingSnapshot[]> {
  const eventIds = [...new Set(snapshots.flatMap(snapshot => Object.keys(snapshot.eventRevisions)))];
  const todoIds = [...new Set(snapshots.flatMap(snapshot => Object.keys(snapshot.todoRevisions)))];
  const memoryIds = [...new Set(snapshots.flatMap(snapshot => Object.keys(snapshot.memoryRevisions)))];
  const eventRows = eventIds.length
    ? await database.getAllAsync<{ id: string; revision: number; status: string }>(
      `SELECT id, revision, status FROM assistant_events WHERE id IN (${eventIds.map(() => '?').join(',')})`,
      ...eventIds,
    )
    : [];
  const todoRows = todoIds.length
    ? await database.getAllAsync<{ id: string; revision_at: number }>(
      `SELECT id, revision_at FROM entries WHERE kind='task' AND id IN (${todoIds.map(() => '?').join(',')})`,
      ...todoIds,
    )
    : [];
  const memoryRows = memoryIds.length
    ? await database.getAllAsync<{ id: string; revision: number }>(
      `SELECT id, revision FROM assistant_memories WHERE id IN (${memoryIds.map(() => '?').join(',')})`,
      ...memoryIds,
    )
    : [];
  const currentEvents = new Map(eventRows.map(row => [row.id, {
    revision: Number(row.revision), status: row.status,
  }]));
  const currentTodos = new Map(todoRows.map(row => [row.id, Number(row.revision_at)]));
  const currentMemories = new Map(memoryRows.map(row => [row.id, Number(row.revision)]));
  return snapshots.filter(snapshot => (
    Object.entries(snapshot.eventRevisions).every(([id, revision]) => {
      const current = currentEvents.get(id);
      return current?.status === 'active' && current.revision === revision;
    })
    && Object.entries(snapshot.todoRevisions).every(([id, revision]) => currentTodos.get(id) === revision)
    && Object.entries(snapshot.memoryRevisions).every(([id, revision]) => currentMemories.get(id) === revision)
  ));
}

export async function loadValidAssistantWorkingSnapshots(
  segmentId?: string | null,
): Promise<AssistantWorkingSnapshot[]> {
  if (!segmentId) return [];
  const segmentSnapshots = snapshotsBySegment.get(segmentId);
  if (!segmentSnapshots?.size) return [];
  const { withDatabaseConnection } = await import('../db');
  const valid = await withDatabaseConnection(database => (
    validSnapshotsWithDatabase(database, [...segmentSnapshots.values()])
  ));
  const validIds = new Set(valid.map(snapshot => snapshot.id));
  for (const id of segmentSnapshots.keys()) {
    if (!validIds.has(id)) segmentSnapshots.delete(id);
  }
  if (!segmentSnapshots.size) snapshotsBySegment.delete(segmentId);
  return valid.sort((left, right) => right.readAt - left.readAt);
}

export function readSetFromAssistantWorkingSnapshots(
  snapshots: AssistantWorkingSnapshot[],
): AssistantReadSet {
  return {
    eventIds: [...new Set(snapshots.flatMap(snapshot => snapshot.readEventIds))],
    todoIds: [...new Set(snapshots.flatMap(snapshot => snapshot.readTodoIds))],
    memoryIds: [...new Set(snapshots.flatMap(snapshot => snapshot.readMemoryIds))],
  };
}

export function clearAssistantWorkingSnapshotsForTests(): void {
  snapshotsBySegment.clear();
}
