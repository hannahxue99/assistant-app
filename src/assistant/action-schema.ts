/**
 * 小知待办与事件操作的增量事实表。
 *
 * 待办继续复用 entries(kind='task')；这里仅保存事件、关系与可撤销操作日志。
 * 所有迁移均为增量创建，旧 topic/entries 数据保持不变。
 */
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

  CREATE TABLE IF NOT EXISTS assistant_operations (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN (
      'create_todo', 'update_todo', 'complete_todo', 'create_event', 'update_event',
      'append_event_update', 'rename_event', 'pin_event', 'link_todo_event'
    )),
    object_type TEXT NOT NULL CHECK (object_type IN ('todo', 'event', 'event_update', 'relation')),
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
  );
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(request_id) REFERENCES assistant_requests(id),
    FOREIGN KEY(user_message_id) REFERENCES assistant_messages(id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_decision_logs_created
    ON assistant_decision_logs(created_at DESC, request_id DESC);
`;
