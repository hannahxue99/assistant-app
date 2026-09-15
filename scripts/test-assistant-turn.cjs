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
    try { await callback(adapter); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};

let providerCalls = 0;
let provider = async () => ({ reply: '默认回复', segment: { action: 'continue' }, operations: [] });
const cache = new Map();
function load(file) {
  const normalized = path.posix.normalize(file);
  if (cache.has(normalized)) return cache.get(normalized);
  const exports = {};
  cache.set(normalized, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, normalized), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, Promise, Set, Map, JSON, Math, console, AbortController,
    setTimeout, clearTimeout,
    require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
      const base = path.posix.dirname(normalized);
      const resolved = path.posix.normalize(path.posix.join(base, name));
      const candidates = resolved.endsWith('.ts') ? [resolved] : [`${resolved}.ts`, `${resolved}/index.ts`];
      const target = candidates.find(candidate => fs.existsSync(path.join(root, candidate)));
      if (!target) throw new Error(`Cannot resolve ${name} from ${normalized}`);
      if (target === 'src/engine/notifications.ts') return { syncEntryReminder: async () => {} };
      if (target === 'src/engine/llm.ts') return { understandWithLlm: async () => ({}) };
      if (target === 'src/assistant/provider.ts') {
        return { requestAssistantTurn: async input => { providerCalls++; return provider(input); } };
      }
      return load(target);
    },
  }, { filename: normalized });
  return exports;
}

async function main() {
  const db = load('src/db.ts');
  const store = load('src/assistant/store.ts');
  const orchestrator = load('src/assistant/orchestrator.ts');
  await db.initDatabase();
  const settings = {
    llmEnabled: true,
    llmBaseUrl: 'https://example.test/v1',
    llmKey: 'fixture',
    llmModel: 'fixture',
  };

  let release;
  provider = async input => {
    const saved = await store.listMessages({ limit: 20 });
    assert.ok(saved.some(item => item.requestId === 'request-1' && item.role === 'user'),
      '调用模型前必须已保存用户原话');
    assert.equal(input.context.recentMessages.at(-1).content, '我们继续聊照片整理',
      '当前用户消息必须进入最近原话上下文');
    return new Promise(resolve => { release = resolve; });
  };
  const first = orchestrator.sendAssistantTurn({
    requestId: 'request-1', content: '我们继续聊照片整理', source: 'text', settings, createdAt: 1000,
  });
  const duplicate = orchestrator.sendAssistantTurn({
    requestId: 'request-1', content: '重复点击', source: 'text', settings, createdAt: 1001,
  });
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first, duplicate, '同一请求并发发送必须共享同一个任务');
  assert.equal(providerCalls, 1, '同一请求并发只能调用一次模型');
  release({ reply: '好，我们继续。', segment: { action: 'continue', summary: '用户继续讨论照片整理。' }, operations: [] });
  const completed = await first;
  assert.equal(completed.assistantMessage.content, '好，我们继续。');

  provider = async () => { throw Object.assign(new Error('offline'), { code: 'network' }); };
  await assert.rejects(orchestrator.sendAssistantTurn({
    requestId: 'request-2', content: '断网时也要保存', source: 'text', settings, createdAt: 2000,
  }), /offline/);
  const failed = (await store.listMessages({ limit: 20 })).find(item => item.requestId === 'request-2');
  assert.equal(failed.status, 'failed', '模型失败后原话应保留为可重试');

  provider = async () => ({ reply: '网络恢复了。', segment: { action: 'continue' }, operations: [] });
  const retried = await orchestrator.retryAssistantTurn({ requestId: 'request-2', settings });
  assert.equal(retried.assistantMessage.content, '网络恢复了。');
  assert.equal((await store.listMessages({ limit: 20 })).filter(item => item.requestId === 'request-2').length, 2,
    '重试应复用用户消息，只新增一条助手回复');

  provider = async () => ({
    reply: '我们换到新话题。',
    segment: { action: 'split_before_user', previousSummary: '照片整理讨论结束。', summary: '开始讨论旅行。' },
    operations: [],
  });
  await orchestrator.sendAssistantTurn({
    requestId: 'request-3', content: '说说下次旅行吧', source: 'text', settings, createdAt: 3000,
  });
  const segments = sqlite.prepare('SELECT * FROM conversation_segments ORDER BY started_at').all();
  assert.equal(segments.filter(item => item.status === 'current').length, 1, '始终只能有一个当前分段');
  assert.ok(segments.some(item => item.status === 'closed' && item.summary === '照片整理讨论结束。'),
    '切换话题必须关闭旧分段并保存最终摘要');

  provider = async () => ({
    reply: '好，明天买牛奶。',
    segment: { action: 'continue' },
    operations: [
      { key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '买牛奶', dateStatus: 'resolved', dateText: '明天', dueDate: '2026-09-16', timePrecision: 'date' },
      { key: 'event', type: 'create_event', eventRef: 'event_1', title: '买牛奶', currentState: '准备购买' },
    ],
  });
  const oneOff = await orchestrator.sendAssistantTurn({
    requestId: 'request-4', content: '明天买牛奶', source: 'text', settings,
    createdAt: new Date('2026-09-15T10:00:00+08:00').getTime(),
  });
  assert.equal(oneOff.operations.length, 1, '一次性行动只应提交待办，不提交事件');
  assert.equal(oneOff.operations[0].operationType, 'create_todo');
  const milkTodo = sqlite.prepare("SELECT * FROM entries WHERE kind='task' AND summary='买牛奶'").get();
  assert.ok(milkTodo?.due_at, '有日期待办应写入现有 entries 并解析日期');
  assert.equal(milkTodo.time_precision, 'date', '模型给出的日期精度必须随待办落库');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_events WHERE title='买牛奶'").get().count, 0);
  const oneOffLog = sqlite.prepare("SELECT * FROM assistant_decision_logs WHERE request_id='request-4'").get();
  assert.equal(oneOffLog.status, 'committed', '决策日志应记录最终提交状态');
  assert.ok(JSON.parse(oneOffLog.proposed_operations_json).some(item => item.type === 'create_todo'),
    '决策日志应保留模型提出的待办');
  assert.ok(JSON.parse(oneOffLog.validation_json).rejected.some(item => item.type === 'create_event'),
    '决策日志应保留本地拒绝的事件及原因');

  provider = async () => ({
    reply: '我们继续沿着换房这条主线聊。',
    segment: { action: 'continue', summary: '用户开始持续推进换房计划。' },
    operations: [
      { key: 'event', type: 'create_event', eventRef: 'event_1', title: '换房计划', currentState: '开始看房' },
      { key: 'progress', type: 'append_event_update', event: { kind: 'local', ref: 'event_1' }, content: '开始看房' },
      { key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '周六看第二套房', dateStatus: 'resolved', dateText: '周六', dueDate: '2026-09-19', timePrecision: 'date' },
      { key: 'link', type: 'link_todo_event', todo: { kind: 'local', ref: 'todo_1' }, event: { kind: 'local', ref: 'event_1' } },
    ],
  });
  const eventTurn = await orchestrator.sendAssistantTurn({
    requestId: 'request-5', content: '换房计划要持续跟进，周六看第二套房', source: 'text', settings,
    createdAt: new Date('2026-09-15T11:00:00+08:00').getTime(),
  });
  assert.equal(eventTurn.operations.length, 4, '同轮事件、进展、待办和关联应合并提交');
  const houseEvent = sqlite.prepare("SELECT * FROM assistant_events WHERE title='换房计划'").get();
  assert.equal(houseEvent.current_state, '开始看房');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_event_updates WHERE event_id=?').get(houseEvent.id).count, 1);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM assistant_object_relations
    WHERE from_type='todo' AND relation_type='belongs_to' AND to_id=?`).get(houseEvent.id).count, 1);

  provider = async () => ({
    reply: '还款计划继续沿用这条主线。',
    segment: { action: 'continue' },
    operations: [{ key: 'state', type: 'update_event', eventId: houseEvent.id, currentState: '下个月10号继续还款' }],
  });
  const modelOnlyEvent = await orchestrator.sendAssistantTurn({
    requestId: 'request-model-only-event', content: '下个月10号还', source: 'text', settings,
    createdAt: new Date('2026-09-15T11:30:00+08:00').getTime(),
  });
  assert.equal(modelOnlyEvent.operations.length, 1, '模型只提出事件时本地不得自行补建待办');
  const modelOnlyLog = sqlite.prepare("SELECT * FROM assistant_decision_logs WHERE request_id='request-model-only-event'").get();
  assert.deepEqual(JSON.parse(modelOnlyLog.proposed_operations_json).map(item => item.type), ['update_event'],
    '日志必须明确显示模型该轮没有提出待办');

  const retriedSucceeded = await orchestrator.retryAssistantTurn({ requestId: 'request-5', settings });
  assert.equal(retriedSucceeded.operations.length, 4, '成功请求重试应读取原操作回执');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_events WHERE title='换房计划'").get().count, 1,
    '成功请求重试不得重复创建事件');

  provider = async () => ({
    reply: '先保留这件事，时间可以接着补。',
    segment: { action: 'continue' },
    operations: [{ key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '整理照片', dateStatus: 'absent' }],
  });
  await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo', content: '有空整理一下照片', source: 'text', settings, createdAt: 4800,
  });
  const hiddenTodo = sqlite.prepare("SELECT * FROM entries WHERE kind='task' AND summary='整理照片'").get();
  assert.equal(hiddenTodo.due_at, null, '首次无日期行动应保存为隐藏待办');
  provider = async input => {
    assert.ok(input.context.contextBlock.includes(hiddenTodo.id), '当前分段最近待办必须进入补日期上下文');
    return {
      reply: '时间按周六继续安排。',
      segment: { action: 'continue' },
      operations: [{ key: 'date', type: 'update_todo', todoId: hiddenTodo.id, dateStatus: 'resolved', dateText: '周六', dueDate: '2026-09-19', timePrecision: 'date' }],
    };
  };
  await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo-date', content: '那就周六吧', source: 'text', settings,
    createdAt: new Date('2026-09-15T12:00:00+08:00').getTime(),
  });
  assert.ok(sqlite.prepare('SELECT due_at FROM entries WHERE id=?').get(hiddenTodo.id).due_at,
    '日期补充应更新同一条隐藏待办');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM entries WHERE kind='task' AND summary='整理照片'").get().count, 1,
    '补日期不得创建重复待办');

  sqlite.exec(`CREATE TRIGGER fail_assistant_operation
    BEFORE INSERT ON assistant_operations BEGIN SELECT RAISE(ABORT, 'forced operation failure'); END;`);
  provider = async () => ({
    reply: '这只是自然回复，不能单独保存。',
    segment: { action: 'continue' },
    operations: [{ key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '不应留下的待办', dateStatus: 'absent' }],
  });
  await assert.rejects(orchestrator.sendAssistantTurn({
    requestId: 'request-rollback', content: '记一个不应留下的待办', source: 'text', settings, createdAt: 5000,
  }), /forced operation failure/);
  sqlite.exec('DROP TRIGGER fail_assistant_operation');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM entries WHERE summary='不应留下的待办'").get().count, 0,
    '操作日志失败时对象写入必须一起回滚');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_messages WHERE request_id='request-rollback' AND role='assistant'").get().count, 0,
    '事务失败时不得留下助手成功回复');
  assert.equal(sqlite.prepare("SELECT status FROM assistant_requests WHERE id='request-rollback'").get().status, 'failed',
    '事务失败后用户原话应保留为可重试状态');

  console.log('assistant turn tests passed');
  sqlite.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
