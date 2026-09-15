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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, Promise, Set, Map, JSON, Math, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
      const base = path.posix.dirname(normalized);
      const resolved = path.posix.normalize(path.posix.join(base, name));
      const candidates = resolved.endsWith('.ts') ? [resolved] : [`${resolved}.ts`, `${resolved}/index.ts`];
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
  const assistantSchema = load('src/assistant/schema.ts').assistantSchema;
  const { ensureAssistantOperationSchema } = load('src/assistant/action-schema.ts');
  sqlite.exec(assistantSchema);
  sqlite.exec(`
    CREATE TABLE assistant_operations (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('create_todo')),
      object_type TEXT NOT NULL CHECK (object_type IN ('todo')),
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
    INSERT INTO conversation_segments VALUES ('segment-old', '', 'current', 1, NULL, 1);
    INSERT INTO assistant_messages VALUES ('message-old', 'request-old', 'user', '旧待办', 'text', 'saved', 'segment-old', NULL, 1, 1);
    INSERT INTO assistant_requests VALUES ('request-old', 'message-old', 'succeeded', NULL, 1, 1, 1);
    INSERT INTO assistant_operations VALUES (
      'operation-old', 'request-old', 'todo', 'create_todo', 'todo', 'todo-old',
      NULL, '{}', '建立待办：旧待办', 'committed', 0, 1, NULL
    );
  `);

  await ensureAssistantOperationSchema(adapter);
  await ensureAssistantOperationSchema(adapter);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_operations').get().count, 1,
    '旧操作迁移后必须完整保留且重复执行幂等');
  sqlite.prepare(`INSERT INTO assistant_operations VALUES (
    'operation-memory', 'request-old', 'memory', 'create_memory', 'memory', 'memory-1',
    NULL, '{}', '记住：不喜欢早会', 'committed', 1, 2, NULL
  )`).run();

  const db = load('src/db.ts');
  await db.initDatabase();
  const memoryStore = load('src/assistant/memory-store.ts');
  const memoryMigration = load('src/assistant/memory-migration.ts');
  const memoryValidator = load('src/assistant/memory-validator.ts');
  for (const table of ['assistant_memories', 'assistant_memory_sources']) {
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)?.name, table);
  }
  const sql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assistant_operations'").get().sql;
  assert.match(sql, /create_memory/);
  assert.match(sql, /memory/);

  await db.saveProfile({
    name: '', goals: ['建立长期陪伴型私人 AI'], avoid: ['不喜欢早会'],
    notifyMorning: true, notifyEvening: true,
  });
  assert.equal(await memoryMigration.migrateProfileToLongTermMemories(), 2,
    '旧画像应迁移一条 active 偏好和一条 candidate 目标');
  assert.equal(await memoryMigration.migrateProfileToLongTermMemories(), 0, '画像迁移必须幂等');
  const migratedActive = await memoryStore.listActiveMemories();
  const migratedCandidates = await memoryStore.listMemoryCandidates();
  assert.equal(migratedActive.length, 1);
  assert.equal(migratedActive[0].content, '不喜欢早会');
  assert.equal(migratedCandidates.length, 1);
  assert.equal(migratedCandidates[0].content, '建立长期陪伴型私人 AI');

  const sourceMemory = await memoryStore.createMemoryWithDatabase(adapter, {
    id: 'memory-source-test', category: 'principle', content: '重要决策先理清关键问题',
    status: 'candidate', sensitivity: 'ordinary', admissionBasis: 'inferred', createdAt: 3000,
  });
  await memoryStore.addMemorySourceWithDatabase(adapter, {
    id: 'source-1', memoryId: sourceMemory.id, sourceMessageId: 'message-old',
    evidence: '旧待办', createdAt: 3000,
  });
  await memoryStore.addMemorySourceWithDatabase(adapter, {
    id: 'source-duplicate', memoryId: sourceMemory.id, sourceMessageId: 'message-old',
    evidence: '重复来源', createdAt: 3001,
  });
  assert.equal((await memoryStore.listMemorySources(sourceMemory.id)).length, 1,
    '同一用户消息不能重复增加记忆证据数');
  const repeatedValidation = await memoryValidator.validateAssistantMemoryDeltas({
    deltas: [{
      key: 'memory_delta_1', action: 'activate_candidate', memoryId: sourceMemory.id,
      expectedRevision: sourceMemory.revision, admissionBasis: 'repeated', evidence: '重要决策先理清关键问题',
    }],
    context: { active: [], candidates: [sourceMemory] },
    userMessage: '我还是觉得重要决策先理清关键问题',
    userMessageId: 'message-repeat',
  });
  assert.equal(repeatedValidation.accepted.length, 1,
    '候选存在一条旧来源且本轮是新消息时允许 repeated 生效');
  const inventedEvidence = await memoryValidator.validateAssistantMemoryDeltas({
    deltas: [{
      key: 'memory_delta_1', action: 'create_active', category: 'preference',
      content: '不喜欢加班', sensitivity: 'ordinary', admissionBasis: 'explicit', evidence: '用户不喜欢加班',
    }],
    context: { active: [], candidates: [] },
    userMessage: '记住，我不喜欢加班',
    userMessageId: 'message-invented',
  });
  assert.equal(inventedEvidence.rejected[0].reason, 'evidence_not_in_user_message',
    '模型改写不得冒充用户原话证据');
  const secretValidation = await memoryValidator.validateAssistantMemoryDeltas({
    deltas: [{
      key: 'memory_delta_1', action: 'create_active', category: 'preference',
      content: '登录密码是 abc123', sensitivity: 'sensitive', admissionBasis: 'explicit', evidence: '登录密码是 abc123',
    }],
    context: { active: [], candidates: [] },
    userMessage: '登录密码是 abc123',
    userMessageId: 'message-secret',
  });
  assert.equal(secretValidation.rejected[0].reason, 'forbidden_secret', '凭证类信息始终不得入库');

  const beforeEdit = migratedActive[0];
  const edited = await memoryStore.editMemory({
    id: beforeEdit.id, expectedRevision: beforeEdit.revision,
    content: '上午尽量不安排会议', updatedAt: 4000,
  });
  assert.equal(edited.memory.content, '上午尽量不安排会议');
  assert.equal((await memoryStore.getMemory(beforeEdit.id)).status, 'superseded');
  assert.equal(await memoryStore.undoMemoryUiAction(edited.undo, 4100), true);
  assert.equal((await memoryStore.getMemory(beforeEdit.id)).status, 'active', '撤销编辑应恢复旧 active 版本');

  const restored = await memoryStore.getMemory(beforeEdit.id);
  const forgotten = await memoryStore.forgetMemory({
    id: restored.id, expectedRevision: restored.revision, updatedAt: 4200,
  });
  assert.equal((await memoryStore.getMemory(restored.id)).status, 'forgotten');
  assert.equal(await memoryStore.undoMemoryUiAction(forgotten.undo, 4300), true);
  const activeAgain = await memoryStore.getMemory(restored.id);
  assert.equal(activeAgain.status, 'active', '撤销忘记应恢复 active');
  assert.equal(await memoryStore.forgetMemory({
    id: activeAgain.id, expectedRevision: activeAgain.revision - 1, updatedAt: 4400,
  }), null, '旧 revision 不得覆盖较新记忆');
  console.log('assistant memory database tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
