export const assistantMemorySchema = `
  CREATE TABLE IF NOT EXISTS assistant_memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN (
      'preference', 'principle', 'long_term_goal', 'important_relationship', 'recurring_pattern'
    )),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 200),
    normalized_content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'superseded', 'forgotten')),
    sensitivity TEXT NOT NULL DEFAULT 'ordinary' CHECK (sensitivity IN ('ordinary', 'sensitive')),
    admission_basis TEXT NOT NULL CHECK (admission_basis IN (
      'explicit', 'repeated', 'confirmed', 'inferred', 'manual_edit', 'profile_migration'
    )),
    superseded_by_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    activated_at INTEGER,
    superseded_at INTEGER,
    forgotten_at INTEGER,
    FOREIGN KEY(superseded_by_id) REFERENCES assistant_memories(id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_memories_active
    ON assistant_memories(status, updated_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_assistant_memories_normalized
    ON assistant_memories(normalized_content, status);

  CREATE TABLE IF NOT EXISTS assistant_memory_sources (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    source_message_id TEXT,
    evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0 AND length(evidence) <= 200),
    created_at INTEGER NOT NULL,
    FOREIGN KEY(memory_id) REFERENCES assistant_memories(id),
    FOREIGN KEY(source_message_id) REFERENCES assistant_messages(id),
    UNIQUE(memory_id, source_message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_assistant_memory_sources_memory
    ON assistant_memory_sources(memory_id, created_at, id);
`;
