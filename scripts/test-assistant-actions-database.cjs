const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const sqlite = new DatabaseSync(':memory:');
const adapter = {
  execAsync: async sql => sqlite.exec(sql),
  getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...args),
  withExclusiveTransactionAsync: async callback => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      await callback(adapter);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};

const cache = new Map();
function load(file) {
  const normalized = path.posix.normalize(file);
  if (cache.has(normalized)) return cache.get(normalized);
  const exports = {};
  cache.set(normalized, exports);
  const source = fs.readFileSync(path.join(root, normalized), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    Date,
    Promise,
    Set,
    Map,
    JSON,
    Math,
    console,
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
      const base = path.posix.dirname(normalized);
      const resolved = path.posix.normalize(path.posix.join(base, name));
      const candidates = resolved.endsWith('.ts')
        ? [resolved]
        : [`${resolved}.ts`, `${resolved}/index.ts`];
      const target = candidates.find(candidate => fs.existsSync(path.join(root, candidate)));
      if (!target) throw new Error(`Cannot resolve ${name} from ${normalized}`);
      if (target === 'src/engine/notifications.ts') return { syncEntryReminder: async () => {} };
      if (target === 'src/engine/llm.ts') return { understandWithLlm: async () => ({}) };
      return load(target);
    },
  }, { filename: normalized });
  return exports;
}

async function main() {
  const db = load('src/db.ts');
  await db.initDatabase();

  const expectedTables = [
    'assistant_events',
    'assistant_event_aliases',
    'assistant_event_updates',
    'assistant_object_relations',
    'assistant_operations',
  ];
  for (const table of expectedTables) {
    const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.equal(row?.name, table, `${table} 应在数据库初始化时创建`);
  }

  sqlite.prepare(`INSERT INTO conversation_segments (
    id, summary, status, started_at, ended_at, updated_at
  ) VALUES ('segment-1', '', 'current', 1000, NULL, 1000)`).run();
  sqlite.prepare(`INSERT INTO assistant_messages (
    id, request_id, role, content, source, status, segment_id,
    legacy_entry_id, created_at, updated_at
  ) VALUES ('message-1', 'request-1', 'user', '整理照片', 'text', 'saved',
    'segment-1', NULL, 1000, 1000)`).run();
  sqlite.prepare(`INSERT INTO assistant_requests (
    id, user_message_id, status, error_code, attempt_count, created_at, updated_at
  ) VALUES ('request-1', 'message-1', 'succeeded', NULL, 1, 1000, 1000)`).run();

  sqlite.prepare(`INSERT INTO assistant_operations (
    id, request_id, operation_key, operation_type, object_type, object_id,
    before_snapshot, after_snapshot, receipt_summary, status, sequence, created_at, undone_at
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'committed', ?, ?, NULL)`).run(
    'operation-1', 'request-1', 'todo-1', 'create_todo', 'todo', 'entry-1',
    '{}', '建立待办：整理照片', 0, 1000,
  );
  assert.throws(() => sqlite.prepare(`INSERT INTO assistant_operations (
    id, request_id, operation_key, operation_type, object_type, object_id,
    before_snapshot, after_snapshot, receipt_summary, status, sequence, created_at, undone_at
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'committed', ?, ?, NULL)`).run(
    'operation-2', 'request-1', 'todo-1', 'create_todo', 'todo', 'entry-2',
    '{}', '重复操作', 1, 1001,
  ), /UNIQUE/, '同一请求内的操作键必须唯一');

  console.log('assistant action database schema tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
