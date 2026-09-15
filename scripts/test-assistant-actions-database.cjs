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
  const assistantStore = load('src/assistant/store.ts');
  const eventStore = load('src/assistant/event-store.ts');
  const eventMigration = load('src/assistant/event-migration.ts');
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

  const firstEvent = await eventStore.createEvent({
    id: 'event-mortgage',
    title: '房贷还款',
    currentState: '今天提前还款 30 万',
    createdAt: 2000,
  });
  assert.equal(firstEvent.revision, 1);
  assert.equal((await eventStore.getEvent(firstEvent.id)).currentState, '今天提前还款 30 万');

  const updated = await eventStore.updateEventState({
    eventId: firstEvent.id,
    currentState: '预计仍剩 30 多万',
    expectedRevision: 1,
    updatedAt: 2100,
  });
  assert.equal(updated?.currentState, '预计仍剩 30 多万');
  assert.equal(updated?.revision, 2);
  assert.equal(await eventStore.updateEventState({
    eventId: firstEvent.id,
    currentState: '这个更新基于旧版本，不应覆盖',
    expectedRevision: 1,
    updatedAt: 2200,
  }), null, '事件状态更新必须检查 revision');

  const progress = await eventStore.appendEventUpdate({
    id: 'update-mortgage-1',
    eventId: firstEvent.id,
    content: '已提前还款 30 万',
    stableKey: 'request-2:progress-1',
    occurredAt: 2100,
    sourceMessageId: null,
  });
  const duplicateProgress = await eventStore.appendEventUpdate({
    id: 'update-mortgage-duplicate',
    eventId: firstEvent.id,
    content: '重复内容不应再写',
    stableKey: 'request-2:progress-1',
    occurredAt: 2200,
    sourceMessageId: null,
  });
  assert.equal(duplicateProgress.id, progress.id, '进展 stableKey 重复时应复用原记录');
  assert.equal((await eventStore.listEventUpdates(firstEvent.id)).length, 1);

  const renamed = await eventStore.renameEvent({
    eventId: firstEvent.id,
    title: '住房贷款',
    expectedRevision: 3,
    updatedAt: 2300,
  });
  assert.equal(renamed?.title, '住房贷款');
  assert.deepEqual(await eventStore.listEventAliases(firstEvent.id), ['房贷还款']);

  await eventStore.createEvent({
    id: 'event-photos',
    title: '照片整理',
    currentState: '尚未开始',
    createdAt: 2400,
  });
  await eventStore.setEventPinned({ eventId: firstEvent.id, pinned: true, updatedAt: 2500 });
  assert.equal((await eventStore.listEvents({ limit: 10 }))[0].id, firstEvent.id, '置顶事件应排在最前');
  assert.equal(await eventStore.getEvent('missing-event'), null);

  await db.insertEntry({ rawText: '第一次看房', source: 'text', createdAt: 3000 }, {
    kind: 'info', summary: '开始看房', dueAt: null, tags: [], topic: '换房计划', persons: [],
  });
  await db.insertEntry({ rawText: '今天看了第二套', source: 'text', createdAt: 3100 }, {
    kind: 'info', summary: '已经看完第二套房', dueAt: null, tags: [], topic: '换房计划', persons: [],
  });
  await db.insertEntry({ rawText: '报了游泳课', source: 'text', createdAt: 3200 }, {
    kind: 'info', summary: '游泳课已报名', dueAt: null, tags: [], topic: '学游泳', persons: [],
  });
  await assistantStore.projectLegacyEntries(20);

  assert.equal(await eventMigration.migrateLegacyTopicsToEvents(10), 2, '两个旧主题应各迁移一个事件');
  const migratedEvents = (await eventStore.listEvents({ limit: 20 }))
    .filter(event => ['换房计划', '学游泳'].includes(event.title));
  assert.equal(migratedEvents.length, 2);
  const houseEvent = migratedEvents.find(event => event.title === '换房计划');
  assert.equal(houseEvent.currentState, '已经看完第二套房', '当前状态应取主题最近一条摘要');
  assert.equal((await eventStore.listEventUpdates(houseEvent.id)).length, 1, '旧主题只生成一条可见初始进展');
  assert.equal(await eventStore.countEventSourceMessages(houseEvent.id), 2, '主题全部旧记录应保留来源关系');

  const countsBeforeRetry = {
    events: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_events').get().count,
    updates: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_event_updates').get().count,
    relations: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_object_relations').get().count,
  };
  assert.equal(await eventMigration.migrateLegacyTopicsToEvents(10), 0, '重复迁移不应再次处理旧主题');
  assert.deepEqual({
    events: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_events').get().count,
    updates: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_event_updates').get().count,
    relations: sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_object_relations').get().count,
  }, countsBeforeRetry, '重复迁移不得改变事件、进展或关系数量');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM entries WHERE topic='换房计划'").get().count, 2,
    '旧 entries.topic 必须保留作为回滚来源');

  console.log('assistant action database schema tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
