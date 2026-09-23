/**
 * 小知连续对话的持久化底座。
 *
 * 完整消息是事实来源；分段摘要属于可重建缓存。旧 entries 在迁移期保留，
 * assistant_messages.legacy_entry_id 只建立幂等投影，不反向删除旧数据。
 */
export const assistantSchema = `
  CREATE TABLE IF NOT EXISTS conversation_segments (
    id TEXT PRIMARY KEY,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('current', 'closed')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_segments_current
    ON conversation_segments(status) WHERE status='current';
  CREATE INDEX IF NOT EXISTS idx_conversation_segments_updated
    ON conversation_segments(updated_at DESC);

  CREATE TABLE IF NOT EXISTS assistant_requests (
    id TEXT PRIMARY KEY,
    user_message_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    error_code TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assistant_messages (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('text', 'voice', 'legacy', 'contextual', 'assistant')),
    status TEXT NOT NULL CHECK (status IN ('saved', 'sending', 'failed')),
    segment_id TEXT NOT NULL,
    legacy_entry_id TEXT UNIQUE,
    stage_durations_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(segment_id) REFERENCES conversation_segments(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_messages_request_role
    ON assistant_messages(request_id, role);
  CREATE INDEX IF NOT EXISTS idx_assistant_messages_cursor
    ON assistant_messages(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_assistant_messages_segment
    ON assistant_messages(segment_id, created_at, id);

  CREATE TABLE IF NOT EXISTS assistant_web_sources (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(request_id, url),
    FOREIGN KEY(request_id) REFERENCES assistant_requests(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_web_sources_request
    ON assistant_web_sources(request_id, position, id);

  CREATE TABLE IF NOT EXISTS assistant_reasoning (
    request_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(request_id) REFERENCES assistant_requests(id) ON DELETE CASCADE
  );
`;
