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
      if (name === 'expo-sqlite') {
        return { openDatabaseAsync: async () => adapter };
      }
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
  const store = load('src/assistant/store.ts');
  await db.initDatabase();

  for (const table of ['assistant_messages', 'conversation_segments', 'assistant_requests']) {
    const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.equal(row?.name, table, `${table} 应在数据库初始化时创建`);
  }

  const first = await store.saveUserTurn({
    requestId: 'request-1',
    content: '周四晚上提醒我整理照片',
    source: 'text',
    createdAt: 1000,
  });
  const duplicate = await store.saveUserTurn({
    requestId: 'request-1',
    content: '这条重试不应覆盖原文',
    source: 'text',
    createdAt: 2000,
  });
  assert.equal(duplicate.id, first.id, '同一请求重试必须复用原用户消息');
  assert.equal(duplicate.content, first.content, '重试不得覆盖首次保存的原话');

  const reply = await store.completeTurn({
    requestId: 'request-1',
    reply: '好，我先记下。',
    segment: { action: 'continue', summary: '用户准备周四整理照片。' },
    createdAt: 3000,
  });
  const duplicateReply = await store.completeTurn({
    requestId: 'request-1',
    reply: '重复回复不应写入',
    segment: { action: 'continue' },
    createdAt: 4000,
  });
  assert.equal(duplicateReply.id, reply.id, '同一请求只能形成一条助手回复');
  assert.equal(duplicateReply.content, reply.content, '重复完成不得覆盖首次回复');

  const failedUser = await store.saveUserTurn({
    requestId: 'request-2',
    content: '这个消息即使断网也不能丢',
    source: 'text',
    createdAt: 5000,
  });
  await store.failTurn('request-2', 'network');
  const failedRow = await store.getMessage(failedUser.id);
  assert.equal(failedRow.status, 'failed', '失败请求应保留用户消息并标记可重试');
  assert.equal((await store.listMessages({ limit: 20 })).filter(item => item.requestId === 'request-2').length, 1);

  await db.insertEntry({ rawText: '旧原声一', source: 'text', createdAt: 100 });
  await db.insertEntry({ rawText: '旧原声二', source: 'voice', createdAt: 200 });
  assert.equal(await store.projectLegacyEntries(), 2, '首次迁移应投影两条旧原声');
  assert.equal(await store.projectLegacyEntries(), 0, '重复迁移不得产生重复消息');
  const legacy = (await store.listMessages({ limit: 20 })).filter(item => item.legacyEntryId);
  assert.deepEqual(legacy.map(item => item.content), ['旧原声一', '旧原声二']);

  const page = await store.listMessages({ limit: 3 });
  assert.equal(page.length, 3, '第一页应遵守 limit');
  const older = await store.listMessages({ limit: 20, before: page[0] });
  assert.ok(older.every(item => (
    item.createdAt < page[0].createdAt
    || (item.createdAt === page[0].createdAt && item.id < page[0].id)
  )), '游标分页不得重复或越过边界');

  console.log('assistant database tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
