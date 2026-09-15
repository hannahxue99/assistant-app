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
  const actionStore = load('src/assistant/action-store.ts');
  const actionUndo = load('src/assistant/action-undo.ts');
  await db.initDatabase();

  const expectedTables = [
    'assistant_events',
    'assistant_event_aliases',
    'assistant_event_updates',
    'assistant_object_relations',
    'assistant_operations',
    'assistant_decision_logs',
  ];
  for (const table of expectedTables) {
    const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    assert.equal(row?.name, table, `${table} 应在数据库初始化时创建`);
  }
  const decisionLogColumns = new Set(sqlite.prepare('PRAGMA table_info(assistant_decision_logs)').all().map(row => row.name));
  for (const column of [
    'error_detail', 'repair_count', 'repair_status',
    'provider_attempt_count', 'provider_attempts_json', 'protocol_warnings_json',
  ]) {
    assert.ok(decisionLogColumns.has(column), `决策日志必须包含 ${column}`);
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
  assert.equal((await eventStore.getEvent(firstEvent.id)).updatedAt, 2300, '置顶不得篡改事件最新内容时间');
  await eventStore.setEventPinned({ eventId: 'event-photos', pinned: true, updatedAt: 2600 });
  assert.deepEqual(
    (await eventStore.listEvents({ limit: 10 })).slice(0, 2).map(event => event.id),
    ['event-photos', firstEvent.id],
    '多个置顶事件仍应按内容最新时间排序，而不是按置顶操作时间排序',
  );
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
  assert.ok(!(await db.listTopicGroups()).some(group => group.topic === '换房计划'),
    '已迁移主题不应在首页聚合区与事件重复展示');

  const hiddenRelatedTodo = await db.insertEntry({ rawText: '整理换房资料', source: 'text', createdAt: 3300 }, {
    kind: 'task', summary: '整理换房资料', dueAt: null, tags: [], topic: null, persons: [],
  });
  const datedRelatedTodo = await db.insertEntry({ rawText: '周末联系中介', source: 'text', createdAt: 3400 }, {
    kind: 'task', summary: '联系中介', dueAt: 9000, tags: [], topic: null, persons: [],
  });
  await eventStore.linkObjects({
    fromType: 'todo', fromId: hiddenRelatedTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: firstEvent.id, createdAt: 3400,
  });
  await eventStore.linkObjects({
    fromType: 'todo', fromId: datedRelatedTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: firstEvent.id, createdAt: 3401,
  });
  const mortgageDetail = await eventStore.getEventDetail(firstEvent.id);
  assert.equal(mortgageDetail.todos.length, 2, '事件详情应同时展示有日期和隐藏待办');
  assert.ok(mortgageDetail.todos.some(todo => todo.dueAt === null));
  assert.ok(mortgageDetail.todos.some(todo => todo.dueAt === 9000));
  assert.equal(mortgageDetail.updates[0].content, '已提前还款 30 万', '关键进展应按最新在前展示');
  assert.equal(await eventStore.getEventDetail('missing-event'), null, '不存在事件应返回局部空结果');
  const relink = await eventStore.linkObjects({
    fromType: 'todo', fromId: hiddenRelatedTodo.id, relationType: 'related',
    toType: 'event', toId: firstEvent.id, createdAt: 3500,
  });
  sqlite.prepare('UPDATE assistant_object_relations SET undone_at=3600 WHERE id=?').run(relink.id);
  const reactivated = await eventStore.linkObjects({
    fromType: 'todo', fromId: hiddenRelatedTodo.id, relationType: 'related',
    toType: 'event', toId: firstEvent.id, createdAt: 3700,
  });
  assert.equal(reactivated.undoneAt, null, '撤销后的对象关系必须允许再次建立');

  const undoUser = await assistantStore.saveUserTurn({
    requestId: 'request-undo-create', content: '持续跟进搬家，周六打包', source: 'text', createdAt: 4000,
  });
  const undoCreated = await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-undo-create',
    userMessageId: undoUser.id,
    userSource: undoUser.source,
    reply: '我们继续处理搬家。',
    segment: { action: 'continue' },
    operations: [
      { key: 'event', type: 'create_event', eventRef: 'event_1', title: '搬家计划', currentState: '准备打包' },
      { key: 'progress', type: 'append_event_update', event: { kind: 'local', ref: 'event_1' }, content: '开始准备打包' },
      { key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '周六打包', dueAt: 5000 },
      { key: 'link', type: 'link_todo_event', todo: { kind: 'local', ref: 'todo_1' }, event: { kind: 'local', ref: 'event_1' } },
    ],
    actionContext: { events: [], todos: [], explicitEventId: null, segmentEventId: null },
    createdAt: 4000,
  });
  const createdTodoId = undoCreated.operations.find(item => item.operationType === 'create_todo').objectId;
  const createdEventId = undoCreated.operations.find(item => item.operationType === 'create_event').objectId;
  assert.equal((await actionUndo.undoAssistantRequest('request-undo-create', 4100)).status, 'undone');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM entries WHERE id=?').get(createdTodoId).count, 0,
    '撤销新建待办应移除该待办');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_events WHERE id=?').get(createdEventId).count, 0,
    '撤销新建事件应移除事件及本轮进展');
  assert.ok(sqlite.prepare('SELECT entry_id FROM calendar_jobs WHERE entry_id=?').get(createdTodoId),
    '删除待办后必须保留日历补偿队列');
  assert.equal((await actionUndo.undoAssistantRequest('request-undo-create', 4200)).status, 'already-undone',
    '重复撤销必须幂等');

  const mortgageBeforeUndo = await eventStore.getEvent(firstEvent.id);
  const stateUser = await assistantStore.saveUserTurn({
    requestId: 'request-undo-state', content: '房贷现在剩 20 万', source: 'text', createdAt: 4300,
  });
  await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-undo-state',
    userMessageId: stateUser.id,
    userSource: stateUser.source,
    reply: '房贷状态有了变化。',
    segment: { action: 'continue' },
    operations: [{ key: 'state', type: 'update_event', eventId: firstEvent.id, currentState: '现在剩 20 万' }],
    actionContext: {
      events: [{
        id: mortgageBeforeUndo.id, title: mortgageBeforeUndo.title,
        currentState: mortgageBeforeUndo.currentState, aliases: [], linkedTodoTexts: [],
        revision: mortgageBeforeUndo.revision, updatedAt: mortgageBeforeUndo.updatedAt, score: 1,
      }],
      todos: [], explicitEventId: firstEvent.id, segmentEventId: null,
    },
    createdAt: 4300,
  });
  assert.equal((await actionUndo.undoAssistantRequest('request-undo-state', 4400)).status, 'undone');
  assert.equal((await eventStore.getEvent(firstEvent.id)).currentState, mortgageBeforeUndo.currentState,
    '撤销状态更新应恢复操作前状态');

  const conflictTodo = await db.insertEntry({ rawText: '整理合同', source: 'text', createdAt: 4500 }, {
    kind: 'task', summary: '整理合同', dueAt: null, tags: [], topic: null, persons: [],
  });
  const conflictUser = await assistantStore.saveUserTurn({
    requestId: 'request-undo-conflict', content: '改成整理贷款合同', source: 'text', createdAt: 4600,
  });
  await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-undo-conflict',
    userMessageId: conflictUser.id,
    userSource: conflictUser.source,
    reply: '内容需要调整。',
    segment: { action: 'continue' },
    operations: [{ key: 'update', type: 'update_todo', todoId: conflictTodo.id, text: '整理贷款合同' }],
    actionContext: {
      events: [],
      todos: [{
        id: conflictTodo.id, text: conflictTodo.summary, dueAt: null,
        revisionAt: conflictTodo.revisionAt, updatedAt: conflictTodo.updatedAt, score: 1,
      }],
      explicitEventId: null, segmentEventId: null,
    },
    createdAt: 4600,
  });
  await db.setDone(conflictTodo.id, true);
  assert.equal((await actionUndo.undoAssistantRequest('request-undo-conflict', 4700)).status, 'conflict',
    '本轮后对象发生变化时必须拒绝撤销');
  assert.equal((await db.getEntry(conflictTodo.id)).summary, '整理贷款合同', '冲突撤销不得覆盖较新状态');

  console.log('assistant action database schema tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
