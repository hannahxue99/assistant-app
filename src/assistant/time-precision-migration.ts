import { withDatabaseConnection, withExclusiveDatabaseTransaction } from '../db';
import type { AssistantDateProposal } from './action-types';
import { projectModelDate } from './model-date';

const MIGRATION_KEY = 'assistant-time-precision-structured-v1';

type JsonRecord = Record<string, unknown>;

type CandidateEntry = {
  id: string;
  due_at: number;
};

type OperationEvidence = {
  id: string;
  operation_key: string;
  operation_type: 'create_todo' | 'update_todo';
  proposed_operations_json: string;
  proposed_event_deltas_json: string;
  validation_json: string;
  committed_operation_ids_json: string;
  decision_status: string;
};

type ProposalResult =
  | { kind: 'found'; proposal: JsonRecord }
  | { kind: 'invalid' };

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function parseArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function proposalFromEvidence(row: OperationEvidence): ProposalResult {
  const operations = parseArray(row.proposed_operations_json);
  const eventDeltas = parseArray(row.proposed_event_deltas_json);
  if (!operations || !eventDeltas) return { kind: 'invalid' };

  for (const value of operations) {
    const proposal = asRecord(value);
    if (proposal?.key === row.operation_key && proposal.type === row.operation_type) {
      return { kind: 'found', proposal };
    }
  }

  for (const [deltaIndex, value] of eventDeltas.entries()) {
    const delta = asRecord(value);
    if (!delta || !Array.isArray(delta.todos)) continue;
    for (const [todoIndex, todoValue] of delta.todos.entries()) {
      const todo = asRecord(todoValue);
      if (!todo) continue;
      const key = `event-delta-${deltaIndex + 1}-todo-${todoIndex + 1}`;
      const type = todo.action === 'create' ? 'create_todo'
        : todo.action === 'update' ? 'update_todo' : null;
      if (key === row.operation_key && type === row.operation_type) {
        return { kind: 'found', proposal: { ...todo, key, type } };
      }
    }
  }

  return { kind: 'invalid' };
}

function containsString(json: string, expected: string): boolean {
  const values = parseArray(json);
  return values?.some(value => value === expected) ?? false;
}

function validationAccepted(json: string, key: string, type: string): boolean {
  try {
    const validation = asRecord(JSON.parse(json));
    if (!validation || !Array.isArray(validation.accepted)) return false;
    return validation.accepted.some(value => {
      const item = asRecord(value);
      return item?.key === key && item.type === type;
    });
  } catch {
    return false;
  }
}

function evidenceIsCommitted(row: OperationEvidence): boolean {
  return row.decision_status === 'committed'
    && containsString(row.committed_operation_ids_json, row.id)
    && validationAccepted(row.validation_json, row.operation_key, row.operation_type);
}

async function shouldRepairEntry(
  database: Parameters<Parameters<typeof withExclusiveDatabaseTransaction>[0]>[0],
  entry: CandidateEntry,
): Promise<boolean> {
  const operations = await database.getAllAsync<OperationEvidence>(
    `SELECT o.id, o.operation_key, o.operation_type,
            d.proposed_operations_json, d.proposed_event_deltas_json,
            d.validation_json, d.committed_operation_ids_json, d.status AS decision_status
     FROM assistant_operations o
     JOIN assistant_decision_logs d ON d.request_id=o.request_id
     WHERE o.object_type='todo' AND o.object_id=?
       AND o.operation_type IN ('create_todo', 'update_todo')
       AND o.status='committed' AND o.undone_at IS NULL
     ORDER BY o.created_at DESC, o.sequence DESC, o.id DESC`,
    entry.id,
  );

  for (const operation of operations) {
    if (!evidenceIsCommitted(operation)) return false;
    const result = proposalFromEvidence(operation);
    if (result.kind === 'invalid') return false;
    const { proposal } = result;
    if (typeof proposal.dateStatus !== 'string') continue;
    if (proposal.dateStatus !== 'resolved') return false;
    if (typeof proposal.dueDate !== 'string'
      || (proposal.dueTime !== undefined && typeof proposal.dueTime !== 'string')) return false;
    const projected = projectModelDate(proposal as unknown as AssistantDateProposal);
    if (!projected.ok) return false;
    return projected.value.timePrecision === 'dateTime'
      && projected.value.dueAt === entry.due_at;
  }

  return false;
}

export async function migrateStructuredTodoTimePrecision(): Promise<number> {
  const complete = await withDatabaseConnection(database => database.getFirstAsync(
    'SELECT migration_key FROM assistant_migrations WHERE migration_key=?', MIGRATION_KEY,
  ));
  if (complete) return 0;

  return withExclusiveDatabaseTransaction(async (database) => {
    const already = await database.getFirstAsync(
      'SELECT migration_key FROM assistant_migrations WHERE migration_key=?', MIGRATION_KEY,
    );
    if (already) return 0;

    const entries = await database.getAllAsync<CandidateEntry>(
      `SELECT id, due_at FROM entries
       WHERE kind='task' AND due_at IS NOT NULL AND time_precision='date'`,
    );
    let repaired = 0;
    for (const entry of entries) {
      if (!await shouldRepairEntry(database, entry)) continue;
      const result = await database.runAsync(
        `UPDATE entries SET time_precision='dateTime'
         WHERE id=? AND due_at=? AND time_precision='date'`,
        entry.id, entry.due_at,
      );
      repaired += result.changes;
    }

    await database.runAsync(
      'INSERT INTO assistant_migrations (migration_key, completed_at) VALUES (?, ?)',
      MIGRATION_KEY, Date.now(),
    );
    return repaired;
  });
}
