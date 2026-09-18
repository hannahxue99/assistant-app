/**
 * 小知待办与事件操作的增量事实表。
 *
 * 待办继续复用 entries(kind='task')；这里仅保存事件、关系与可撤销操作日志。
 * 所有迁移均为增量创建，旧 topic/entries 数据保持不变。
 */
const ASSISTANT_OPERATION_TYPES = [
  'create_todo', 'update_todo', 'complete_todo', 'delete_todo', 'create_event', 'update_event',
  'append_event_update', 'rename_event', 'pin_event', 'delete_event', 'link_todo_event',
  'create_memory', 'activate_memory', 'supersede_memory', 'forget_memory',
] as const;

const ASSISTANT_OBJECT_TYPES = ['todo', 'event', 'event_update', 'relation', 'memory'] as const;

function operationTableSql(name: string): string {
  return `CREATE TABLE ${name} (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN (${ASSISTANT_OPERATION_TYPES.map(value => `'${value}'`).join(', ')})),
    object_type TEXT NOT NULL CHECK (object_type IN (${ASSISTANT_OBJECT_TYPES.map(value => `'${value}'`).join(', ')})),
    object_id TEXT NOT NULL,
    before_snapshot TEXT,
    after_snapshot TEXT NOT NULL,
    receipt_summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'undone')),
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    created_at INTEGER NOT NULL,
    undone_at INTEGER,
    FOREIGN KEY(request_id) REFERENCES assistant_requests(id),
    UNIQUE(request_id, operation_key),
    UNIQUE(request_id, sequence)
  )`;
}

export const assistantActionSchema = `
  CREATE TABLE IF NOT EXISTS assistant_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    current_state TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    pinned_at INTEGER,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_events_home
    ON assistant_events(status, pinned_at DESC, updated_at DESC);

  CREATE TABLE IF NOT EXISTS assistant_event_aliases (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
    created_at INTEGER NOT NULL,
    FOREIGN KEY(event_id) REFERENCES assistant_events(id),
    UNIQUE(event_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_event_aliases_alias
    ON assistant_event_aliases(alias COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS assistant_migrations (
    migration_key TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assistant_event_updates (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    occurred_at INTEGER NOT NULL,
    source_message_id TEXT,
    stable_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    undone_at INTEGER,
    FOREIGN KEY(event_id) REFERENCES assistant_events(id),
    FOREIGN KEY(source_message_id) REFERENCES assistant_messages(id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_event_updates_event
    ON assistant_event_updates(event_id, occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_assistant_event_updates_source
    ON assistant_event_updates(source_message_id);

  CREATE TABLE IF NOT EXISTS assistant_object_relations (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL CHECK (from_type IN ('message', 'todo', 'event', 'event_update', 'relation')),
    from_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('source', 'belongs_to', 'follows', 'related')),
    to_type TEXT NOT NULL CHECK (to_type IN ('message', 'todo', 'event', 'event_update', 'relation')),
    to_id TEXT NOT NULL,
    source_message_id TEXT,
    created_at INTEGER NOT NULL,
    undone_at INTEGER,
    FOREIGN KEY(source_message_id) REFERENCES assistant_messages(id),
    UNIQUE(from_type, from_id, relation_type, to_type, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_object_relations_from
    ON assistant_object_relations(from_type, from_id, relation_type);
  CREATE INDEX IF NOT EXISTS idx_assistant_object_relations_to
    ON assistant_object_relations(to_type, to_id, relation_type);
  CREATE INDEX IF NOT EXISTS idx_assistant_object_relations_source
    ON assistant_object_relations(source_message_id);

  ${operationTableSql('assistant_operations').replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')};
  CREATE INDEX IF NOT EXISTS idx_assistant_operations_request
    ON assistant_operations(request_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_assistant_operations_object
    ON assistant_operations(object_type, object_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS assistant_decision_logs (
    request_id TEXT PRIMARY KEY,
    user_message_id TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    reference_at INTEGER NOT NULL,
    time_zone TEXT NOT NULL,
    context_refs_json TEXT NOT NULL DEFAULT '{}',
    proposed_operations_json TEXT NOT NULL DEFAULT '[]',
    proposed_event_deltas_json TEXT NOT NULL DEFAULT '[]',
    proposed_memory_deltas_json TEXT NOT NULL DEFAULT '[]',
    validation_json TEXT NOT NULL DEFAULT '{}',
    committed_operation_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('started', 'model_received', 'validated', 'committed', 'failed')),
    provider_started_at INTEGER,
    provider_completed_at INTEGER,
    commit_completed_at INTEGER,
    finish_reason TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    error_code TEXT,
    error_detail TEXT,
    repair_count INTEGER NOT NULL DEFAULT 0,
    repair_status TEXT NOT NULL DEFAULT 'not_needed' CHECK (repair_status IN ('not_needed', 'succeeded', 'failed')),
    provider_attempt_count INTEGER NOT NULL DEFAULT 0,
    provider_attempts_json TEXT NOT NULL DEFAULT '[]',
    protocol_warnings_json TEXT NOT NULL DEFAULT '[]',
    tool_read_event_ids_json TEXT NOT NULL DEFAULT '[]',
    tool_read_todo_ids_json TEXT NOT NULL DEFAULT '[]',
    tool_read_memory_ids_json TEXT NOT NULL DEFAULT '[]',
    execution_outcome TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(request_id) REFERENCES assistant_requests(id),
    FOREIGN KEY(user_message_id) REFERENCES assistant_messages(id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_decision_logs_created
    ON assistant_decision_logs(created_at DESC, request_id DESC);
`;

type OperationSchemaDatabase = {
  getFirstAsync<T>(sql: string, ...args: any[]): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
  withExclusiveTransactionAsync(task: (txn: OperationSchemaDatabase) => Promise<void>): Promise<void>;
};

/** SQLite 无法直接修改 CHECK；旧库需事务化重建操作表并保留全部撤销历史。 */
export async function ensureAssistantOperationSchema(database: OperationSchemaDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='assistant_operations'",
  );
  if (!row || ["'create_memory'", "'memory'", "'delete_todo'", "'delete_event'"]
    .every(value => row.sql.includes(value))) return;

  await database.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      DROP TABLE IF EXISTS assistant_operations_next;
      ${operationTableSql('assistant_operations_next')};
      INSERT INTO assistant_operations_next (
        id, request_id, operation_key, operation_type, object_type, object_id,
        before_snapshot, after_snapshot, receipt_summary, status, sequence, created_at, undone_at
      ) SELECT
        id, request_id, operation_key, operation_type, object_type, object_id,
        before_snapshot, after_snapshot, receipt_summary, status, sequence, created_at, undone_at
      FROM assistant_operations;
    `);
    const before = await txn.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM assistant_operations');
    const after = await txn.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM assistant_operations_next');
    if (Number(before?.count ?? 0) !== Number(after?.count ?? 0)) {
      throw new Error('assistant_operations 迁移行数校验失败');
    }
    await txn.execAsync(`
      DROP TABLE assistant_operations;
      ALTER TABLE assistant_operations_next RENAME TO assistant_operations;
      CREATE INDEX idx_assistant_operations_request
        ON assistant_operations(request_id, sequence);
      CREATE INDEX idx_assistant_operations_object
        ON assistant_operations(object_type, object_id, created_at DESC);
    `);
  });
}
