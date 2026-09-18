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
  const legacyBackup = load('src/engine/legacy-backup.ts');
  const legacyImport = load('src/assistant/legacy-import.ts');
  const actionStore = load('src/assistant/action-store.ts');
  const actionContext = load('src/assistant/action-context.ts');
  const actionUndo = load('src/assistant/action-undo.ts');
  const decisionLog = load('src/assistant/decision-log.ts');
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
    'proposed_event_deltas_json',
    'tool_read_event_ids_json', 'tool_read_todo_ids_json', 'execution_outcome',
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

  await decisionLog.beginAssistantDecisionLog({
    requestId: 'request-1', userMessageId: 'message-1', promptVersion: 'test', model: 'fixture',
    referenceAt: 1000, timeZone: 'Asia/Shanghai',
    contextRefs: {
      recentMessageIds: ['message-1'], segmentIds: [], entryIds: [], eventCandidateIds: [],
      todoCandidateIds: [], memoryIds: [], launchContextId: null,
    },
    createdAt: 1000,
  });
  await decisionLog.recordAssistantModelDecision({
    requestId: 'request-1', operations: [], toolReadEventIds: ['event-trip'], toolReadTodoIds: ['todo-train'],
  });
  await decisionLog.recordAssistantExecutionOutcome({
    requestId: 'request-1', result: { outcome: 'rejected', committed: [], rejected: [{ type: 'event', reason: 'revision_conflict' }] },
  });
  const groundedLog = await decisionLog.getAssistantDecisionLog('request-1');
  assert.deepEqual([...groundedLog.toolReadEventIds], ['event-trip']);
  assert.deepEqual([...groundedLog.toolReadTodoIds], ['todo-train']);
  assert.equal(groundedLog.executionOutcome, 'rejected', '零写入拒绝不得记录为 committed');

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
  const completedRelatedTodo = await db.insertEntry({ rawText: '核对提前还款资格', source: 'text', createdAt: 3450 }, {
    kind: 'task', summary: '核对提前还款资格', dueAt: 8800, tags: [], topic: null, persons: [],
  });
  await db.setDone(completedRelatedTodo.id, true);
  await eventStore.linkObjects({
    fromType: 'todo', fromId: completedRelatedTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: firstEvent.id, createdAt: 3451,
  });
  const loadedActionContext = await actionContext.loadAssistantActionContext({
    query: '这个改到下周吧',
    launchContext: { kind: 'event', id: firstEvent.id, label: '住房贷款', state: '预计仍剩30多万' },
  });
  const loadedMortgage = loadedActionContext.events.find(event => event.id === firstEvent.id);
  assert.ok(loadedMortgage.linkedTodos.some(todo => todo.id === hiddenRelatedTodo.id && todo.done === false),
    '显式事件上下文必须带入未完成相关待办身份与状态');
  assert.ok(loadedMortgage.linkedTodos.some(todo => todo.id === completedRelatedTodo.id && todo.done === true),
    '显式事件上下文必须带入最近完成的相关待办');
  assert.ok(loadedActionContext.todos.some(todo => todo.id === hiddenRelatedTodo.id),
    '事件关联的未完成待办必须进入可修改候选');
  const strictEmptyContext = await actionContext.loadAssistantActionContext({
    query: '住房贷款',
    launchContext: { kind: 'event', id: firstEvent.id, label: '住房贷款' },
    selectionMode: 'read-set',
  });
  assert.equal(strictEmptyContext.events.length, 0,
    '只读授权模式不得把搜索命中或显式入口自动视为已读取事件');
  assert.equal(strictEmptyContext.todos.length, 0,
    '只读授权模式不得把关联待办自动视为已读取待办');
  assert.equal(strictEmptyContext.explicitEventId, null,
    '显式入口只提供模型读取指针，不能绕过精确读取授权写入');
  const strictReadContext = await actionContext.loadAssistantActionContext({
    query: '',
    readEventIds: [firstEvent.id],
    readTodoIds: [hiddenRelatedTodo.id],
    selectionMode: 'read-set',
  });
  assert.deepEqual(strictReadContext.events.map(event => event.id), [firstEvent.id],
    '只读授权模式只能装载精确读取过的事件');
  assert.ok(strictReadContext.todos.some(todo => todo.id === hiddenRelatedTodo.id),
    '精确读取过的待办必须进入版本校验上下文');
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

  const deleteTodoEvent = await eventStore.createEvent({
    id: 'event-delete-todo', title: '健身计划', currentState: '每周训练', createdAt: 4800,
  });
  const deleteTodo = await db.insertEntry({ rawText: '周五去游泳', source: 'text', createdAt: 4810 }, {
    kind: 'task', summary: '周五去游泳', dueAt: 9000, tags: [], topic: null, persons: [],
  });
  await eventStore.linkObjects({
    fromType: 'todo', fromId: deleteTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: deleteTodoEvent.id, createdAt: 4820,
  });
  const deleteTodoUser = await assistantStore.saveUserTurn({
    requestId: 'request-delete-todo', content: '把周五游泳删掉', source: 'text', createdAt: 4830,
  });
  const deletedTodoTurn = await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-delete-todo', userMessageId: deleteTodoUser.id, userSource: deleteTodoUser.source,
    reply: '会删除这条待办。', segment: { action: 'continue' },
    operations: [{ key: 'delete', type: 'delete_todo', todoId: deleteTodo.id }],
    actionContext: {
      events: [{
        id: deleteTodoEvent.id, title: deleteTodoEvent.title, currentState: deleteTodoEvent.currentState,
        aliases: [], linkedTodoTexts: [deleteTodo.summary], linkedTodos: [{
          id: deleteTodo.id, text: deleteTodo.summary, dueAt: deleteTodo.dueAt, done: false,
          revisionAt: deleteTodo.revisionAt, updatedAt: deleteTodo.updatedAt,
        }], revision: deleteTodoEvent.revision, updatedAt: deleteTodoEvent.updatedAt, score: 1,
      }],
      todos: [{
        id: deleteTodo.id, text: deleteTodo.summary, dueAt: deleteTodo.dueAt,
        revisionAt: deleteTodo.revisionAt, updatedAt: deleteTodo.updatedAt, score: 1,
      }], explicitEventId: null, segmentEventId: null,
    },
    createdAt: 4830,
  });
  assert.equal(await db.getEntry(deleteTodo.id), null, '删除待办应移除同一待办实体');
  assert.equal((await eventStore.getEventDetail(deleteTodoEvent.id)).todos.length, 0,
    '删除待办后所有关联事件详情都不应再出现它');
  assert.ok(sqlite.prepare('SELECT entry_id FROM calendar_jobs WHERE entry_id=?').get(deleteTodo.id),
    '删除待办应保留日历删除补偿任务');
  assert.match(deletedTodoTurn.operations[0].receiptSummary, /删除待办/, '删除应生成可撤销回执');
  assert.equal((await actionUndo.undoAssistantRequest('request-delete-todo', 4840)).status, 'undone');
  assert.equal((await db.getEntry(deleteTodo.id)).summary, deleteTodo.summary, '撤销应恢复待办');
  assert.equal((await eventStore.getEventDetail(deleteTodoEvent.id)).todos.length, 1, '撤销应恢复事件关联');

  const keepEvent = await eventStore.createEvent({
    id: 'event-delete-keep', title: '装修计划', currentState: '等待报价', createdAt: 4900,
  });
  const keptTodo = await db.insertEntry({ rawText: '查看装修报价', source: 'text', createdAt: 4910 }, {
    kind: 'task', summary: '查看装修报价', dueAt: null, tags: [], topic: null, persons: [],
  });
  await eventStore.linkObjects({
    fromType: 'todo', fromId: keptTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: keepEvent.id, createdAt: 4920,
  });
  const keepUser = await assistantStore.saveUserTurn({
    requestId: 'request-delete-event-keep', content: '删掉装修事件，待办保留', source: 'text', createdAt: 4930,
  });
  await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-delete-event-keep', userMessageId: keepUser.id, userSource: keepUser.source,
    reply: '会保留关联待办。', segment: { action: 'continue' },
    operations: [{ key: 'delete', type: 'delete_event', eventId: keepEvent.id, linkedTodoPolicy: 'keep' }],
    actionContext: {
      events: [{ ...keepEvent, aliases: [], linkedTodoTexts: [keptTodo.summary], score: 1 }],
      todos: [], explicitEventId: keepEvent.id, segmentEventId: null,
    }, createdAt: 4930,
  });
  assert.equal((await eventStore.getEvent(keepEvent.id)).status, 'closed', '删除事件应软关闭事件');
  assert.equal(await eventStore.getEventDetail(keepEvent.id), null, '已删除事件详情不应继续暴露');
  assert.ok(await db.getEntry(keptTodo.id), '选择保留时关联待办必须保留');
  assert.equal((await actionUndo.undoAssistantRequest('request-delete-event-keep', 4940)).status, 'undone');
  assert.equal((await eventStore.getEvent(keepEvent.id)).status, 'active', '撤销应恢复事件');

  const cascadeEvent = await eventStore.createEvent({
    id: 'event-delete-cascade', title: '搬家计划', currentState: '准备收尾', createdAt: 5000,
  });
  const cascadeOpen = await db.insertEntry({ rawText: '退还钥匙', source: 'text', createdAt: 5010 }, {
    kind: 'task', summary: '退还钥匙', dueAt: null, tags: [], topic: null, persons: [],
  });
  const cascadeDone = await db.insertEntry({ rawText: '打包完成', source: 'text', createdAt: 5020 }, {
    kind: 'task', summary: '打包完成', dueAt: null, tags: [], topic: null, persons: [],
  });
  await db.setDone(cascadeDone.id, true);
  const cascadeDoneCurrent = await db.getEntry(cascadeDone.id);
  for (const [todo, createdAt] of [[cascadeOpen, 5030], [cascadeDoneCurrent, 5040]]) {
    await eventStore.linkObjects({
      fromType: 'todo', fromId: todo.id, relationType: 'belongs_to',
      toType: 'event', toId: cascadeEvent.id, createdAt,
    });
  }
  const cascadeUser = await assistantStore.saveUserTurn({
    requestId: 'request-delete-event-cascade', content: '搬家事件和关联待办都删掉', source: 'voice', createdAt: 5050,
  });
  await actionStore.completeAssistantTurnWithActions({
    requestId: 'request-delete-event-cascade', userMessageId: cascadeUser.id, userSource: cascadeUser.source,
    reply: '会一起删除。', segment: { action: 'continue' },
    operations: [{ key: 'delete', type: 'delete_event', eventId: cascadeEvent.id, linkedTodoPolicy: 'delete' }],
    actionContext: {
      events: [{
        ...cascadeEvent, aliases: [], linkedTodoTexts: [cascadeOpen.summary, cascadeDoneCurrent.summary], score: 1,
        linkedTodos: [
          { id: cascadeOpen.id, text: cascadeOpen.summary, dueAt: null, done: false, revisionAt: cascadeOpen.revisionAt, updatedAt: cascadeOpen.updatedAt },
          { id: cascadeDoneCurrent.id, text: cascadeDoneCurrent.summary, dueAt: null, done: true, revisionAt: cascadeDoneCurrent.revisionAt, updatedAt: cascadeDoneCurrent.updatedAt },
        ],
      }], todos: [], explicitEventId: cascadeEvent.id, segmentEventId: null,
    }, createdAt: 5050,
  });
  assert.equal(await db.getEntry(cascadeOpen.id), null, '级联删除应删除未完成待办');
  assert.equal(await db.getEntry(cascadeDoneCurrent.id), null, '级联删除也应删除已完成待办');
  assert.equal((await eventStore.getEvent(cascadeEvent.id)).status, 'closed');
  assert.equal((await actionUndo.undoAssistantRequest('request-delete-event-cascade', 5060)).status, 'undone');
  assert.ok(await db.getEntry(cascadeOpen.id), '级联撤销应恢复未完成待办');
  assert.equal((await db.getEntry(cascadeDoneCurrent.id)).done, 1, '级联撤销应按原状态恢复已完成待办');
  assert.equal((await eventStore.getEventDetail(cascadeEvent.id)).todos.length, 2, '级联撤销应恢复全部关联');

  const rollbackEvent = await eventStore.createEvent({
    id: 'event-delete-rollback', title: '冲突事件', currentState: '测试回滚', createdAt: 5100,
  });
  const rollbackTodo = await db.insertEntry({ rawText: '冲突待办', source: 'text', createdAt: 5110 }, {
    kind: 'task', summary: '冲突待办', dueAt: null, tags: [], topic: null, persons: [],
  });
  await eventStore.linkObjects({
    fromType: 'todo', fromId: rollbackTodo.id, relationType: 'belongs_to',
    toType: 'event', toId: rollbackEvent.id, createdAt: 5120,
  });
  await db.setDone(rollbackTodo.id, true);
  const rollbackUser = await assistantStore.saveUserTurn({
    requestId: 'request-delete-event-rollback', content: '事件待办一起删', source: 'text', createdAt: 5130,
  });
  await assert.rejects(() => actionStore.completeAssistantTurnWithActions({
    requestId: 'request-delete-event-rollback', userMessageId: rollbackUser.id, userSource: rollbackUser.source,
    reply: '会一起删除。', segment: { action: 'continue' },
    operations: [{ key: 'delete', type: 'delete_event', eventId: rollbackEvent.id, linkedTodoPolicy: 'delete' }],
    actionContext: {
      events: [{
        ...rollbackEvent, aliases: [], linkedTodoTexts: [rollbackTodo.summary], score: 1,
        linkedTodos: [{ id: rollbackTodo.id, text: rollbackTodo.summary, dueAt: null, done: false,
          revisionAt: rollbackTodo.revisionAt, updatedAt: rollbackTodo.updatedAt }],
      }], todos: [], explicitEventId: rollbackEvent.id, segmentEventId: null,
    }, createdAt: 5130,
  }), /版本冲突/, '任一关联待办版本冲突时必须整笔失败');
  assert.equal((await eventStore.getEvent(rollbackEvent.id)).status, 'active', '失败事务不得关闭事件');
  assert.ok(await db.getEntry(rollbackTodo.id), '失败事务不得删除部分待办');

  const legacyEnvelope = legacyBackup.parseLegacyExportMarkdown(`# 我的个人助手记录

## 待办 · 2025/8/21 09:20:00

> 下周五之前把材料交了

**理解**：提交材料

主题：年度述职

时间：2025/8/29 09:00:00

---

## 信息 · 2025/8/22 18:30:00

> 述职材料已经完成初稿

主题：年度述职

---

## 想法 · 2025/8/23 10:00:00

> 复盘时可以先讲三个关键结果

---
`);
  const legacyPreview = await legacyImport.previewLegacyImport(legacyEnvelope);
  assert.equal(JSON.stringify(legacyPreview), JSON.stringify({
    conversations: 3, todos: 1, events: 1, duplicates: 0,
  }), '旧日志预览应分别统计对话、待办、事件和重复');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_messages WHERE source='legacy'").get().count, 3,
    '预览不得写入任何消息');

  const importedLegacy = await legacyImport.importLegacyExport(legacyEnvelope);
  assert.equal(importedLegacy.conversations, 3);
  assert.equal(importedLegacy.todos, 1);
  assert.equal(importedLegacy.events, 1);
  const importedMessages = sqlite.prepare(
    "SELECT content, created_at FROM assistant_messages WHERE source='legacy' AND created_at>=? ORDER BY created_at, id",
  ).all(new Date(2025, 7, 21, 0, 0).getTime());
  assert.deepEqual(importedMessages.map(row => row.content), [
    '下周五之前把材料交了', '述职材料已经完成初稿', '复盘时可以先讲三个关键结果',
  ], '旧原文必须按原时间进入小知历史且不生成助手回复');
  const importedTodo = sqlite.prepare("SELECT * FROM entries WHERE summary='提交材料'").get();
  assert.equal(importedTodo.kind, 'task');
  assert.equal(importedTodo.due_at, new Date(2025, 7, 29, 9, 0).getTime(), '旧待办日期必须直接保留');
  const importedEvent = sqlite.prepare("SELECT * FROM assistant_events WHERE title='年度述职'").get();
  assert.equal(importedEvent.current_state, '述职材料已经完成初稿', '事件当前状态应取主题最新记录');
  assert.equal(sqlite.prepare(
    'SELECT COUNT(*) AS count FROM assistant_event_updates WHERE event_id=? AND stable_key LIKE ?',
  ).get(importedEvent.id, 'legacy-import:%').count, 2, '主题内每条旧记录都应保留为事件进展');
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM assistant_object_relations WHERE from_type='todo' AND from_id=? AND to_id=?",
  ).get(importedTodo.id, importedEvent.id).count, 1, '带主题旧待办应关联到对应事件');

  const repeatPreview = await legacyImport.previewLegacyImport(legacyEnvelope);
  assert.equal(JSON.stringify(repeatPreview), JSON.stringify({
    conversations: 0, todos: 0, events: 0, duplicates: 3,
  }), '重复导入前应明确显示全部记录已存在');
  await legacyImport.importLegacyExport(legacyEnvelope);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM assistant_messages WHERE content='下周五之前把材料交了'",
  ).get().count, 1, '重复导入不得重复生成小知消息');
  assert.equal(sqlite.prepare(
    'SELECT COUNT(*) AS count FROM assistant_event_updates WHERE event_id=? AND stable_key LIKE ?',
  ).get(importedEvent.id, 'legacy-import:%').count, 2, '重复导入不得重复生成事件进展');

  console.log('assistant action database schema tests passed');
  sqlite.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
