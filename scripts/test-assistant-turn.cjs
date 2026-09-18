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
let finalProvider = async input => ({
  reply: input.executionResult.outcome === 'no_change'
    ? input.draftReply
    : input.executionResult.committed.map(item => item.receiptSummary).join('\n') || '没有完成更新',
  providerMetadata: { attemptCount: 1, attempts: [], protocolWarnings: [] },
});
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
        return {
          requestAssistantTurn: async input => { providerCalls++; return provider(input); },
          requestAssistantFinalReply: async input => finalProvider(input),
        };
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
  const workingSnapshots = load('src/assistant/working-snapshots.ts');
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

  provider = async input => {
    input.onReplyText?.('我先帮你梳理到这里');
    return new Promise(resolve => {
      const finishDespiteCancellation = () => resolve({
        reply: '不应提交的完整回复',
        segment: { action: 'continue' },
        operations: [{
          key: 'cancelled-todo', type: 'create_todo', todoRef: 'todo_1',
          text: '不应落库的停止待办', dateStatus: 'absent',
        }],
      });
      if (input.signal?.aborted) finishDespiteCancellation();
      else input.signal?.addEventListener('abort', finishDespiteCancellation, { once: true });
    });
  };
  const cancelledJob = orchestrator.sendAssistantTurn({
    requestId: 'request-cancelled', content: '先规划一下还款', source: 'text', settings, createdAt: 1500,
  });
  void cancelledJob.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await orchestrator.cancelAssistantTurn('request-cancelled'), true,
    '停止按钮必须终止当前任务并完成持久化收尾');
  await assert.rejects(cancelledJob, /取消/);
  const cancelledState = await store.getRequestState('request-cancelled');
  assert.equal(cancelledState.status, 'failed');
  assert.equal(cancelledState.userMessage.status, 'failed', '写库前停止时应保留可重试的用户原话');
  assert.equal(cancelledState.assistantMessage, null,
    '规划阶段的草稿回复不得展示或保存，避免把未执行计划误当结果');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM assistant_operations WHERE request_id='request-cancelled'").get().count, 0,
    '停止请求不得写入任何对象操作');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM entries WHERE summary='不应落库的停止待办'").get().count, 0,
    '即使 Provider 忽略取消并返回完整操作，本地提交闸门也必须整体拒绝');

  provider = async () => { throw Object.assign(new Error('offline'), { code: 'network' }); };
  await assert.rejects(orchestrator.sendAssistantTurn({
    requestId: 'request-2', content: '断网时也要保存', source: 'text', settings, createdAt: 2000,
  }), /offline/);
  const failed = (await store.listMessages({ limit: 20 })).find(item => item.requestId === 'request-2');
  assert.equal(failed.status, 'failed', '模型失败后原话应保留为可重试');
  const networkFailureLog = sqlite.prepare("SELECT * FROM assistant_decision_logs WHERE request_id='request-2'").get();
  assert.equal(networkFailureLog.error_detail, 'offline', '失败日志必须保留精确且有界的错误原因');

  provider = async () => ({ reply: '网络恢复了。', segment: { action: 'continue' }, operations: [] });
  const retried = await orchestrator.retryAssistantTurn({ requestId: 'request-2', settings });
  assert.equal(retried.assistantMessage.content, '网络恢复了。');
  assert.equal((await store.listMessages({ limit: 20 })).filter(item => item.requestId === 'request-2').length, 2,
    '重试应复用用户消息，只新增一条助手回复');

  provider = async () => {
    const error = Object.assign(new Error('operations[0]: resolved 缺少 due_date'), {
      code: 'invalid-response',
      diagnostics: {
        attemptCount: 2,
        attempts: [
          { attempt: 1, startedAt: 2500, completedAt: 2510, errorCode: 'invalid-response', errorDetail: '缺少 due_date', finishReason: 'stop', promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          { attempt: 2, startedAt: 2511, completedAt: 2520, errorCode: 'invalid-response', errorDetail: '缺少 due_date', finishReason: 'stop', promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        ],
        protocolWarnings: ['reply_execution_claim'],
      },
    });
    throw error;
  };
  await assert.rejects(orchestrator.sendAssistantTurn({
    requestId: 'request-protocol-failure', content: '下个月11号还款10万', source: 'text', settings, createdAt: 2500,
  }), /resolved 缺少 due_date/);
  const protocolFailureLog = sqlite.prepare(
    "SELECT * FROM assistant_decision_logs WHERE request_id='request-protocol-failure'",
  ).get();
  assert.equal(protocolFailureLog.error_detail, 'operations[0]: resolved 缺少 due_date');
  assert.equal(protocolFailureLog.provider_attempt_count, 2);
  assert.equal(JSON.parse(protocolFailureLog.provider_attempts_json).length, 2);
  assert.deepEqual(JSON.parse(protocolFailureLog.protocol_warnings_json), ['reply_execution_claim']);

  provider = async () => ({
    reply: '好的，已为你创建待办。',
    segment: { action: 'continue' },
    operations: [],
    providerMetadata: {
      startedAt: 2600, completedAt: 2650, finishReason: 'stop',
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
      attemptCount: 1,
      attempts: [{ attempt: 1, startedAt: 2600, completedAt: 2650, errorCode: null, errorDetail: null, finishReason: 'stop', promptTokens: 10, completionTokens: 5, totalTokens: 15 }],
      protocolWarnings: ['reply_execution_claim'],
    },
  });
  const falseClaim = await orchestrator.sendAssistantTurn({
    requestId: 'request-false-claim', content: '帮我记一下', source: 'text', settings, createdAt: 2600,
  });
  assert.equal(falseClaim.operations.length, 0);
  assert.ok(falseClaim.assistantMessage.content.includes('没有完成'),
    '没有任何合法操作时不得保存模型的虚假成功措辞');
  const falseClaimLog = sqlite.prepare(
    "SELECT status, execution_outcome FROM assistant_decision_logs WHERE request_id='request-false-claim'",
  ).get();
  assert.notEqual(falseClaimLog.status, 'committed', '零写入不得再把决策日志标为 committed');
  assert.equal(falseClaimLog.execution_outcome, 'rejected', '虚假执行声称必须记录为 rejected');

  provider = async () => ({
    reply: '准备记录牙科复诊。',
    segment: { action: 'continue' },
    operations: [{
      key: 'dentist', type: 'create_todo', todoRef: 'todo_1', text: '牙科复诊',
      dateStatus: 'resolved', dateText: '后天', dueDate: '1970-01-03', timePrecision: 'date',
    }],
  });
  finalProvider = async () => { throw Object.assign(new Error('final narration offline'), { code: 'network' }); };
  const fallbackAfterCommit = await orchestrator.sendAssistantTurn({
    requestId: 'request-final-fallback', content: '后天去牙科复诊', source: 'text', settings, createdAt: 2700,
  });
  assert.equal(fallbackAfterCommit.operations.length, 1, '最终表述失败不能回滚已经提交的数据');
  assert.ok(fallbackAfterCommit.assistantMessage.content.includes('建立待办：牙科复诊'),
    '最终表述失败时必须使用真实操作回执，而不是模型规划草稿');
  finalProvider = async input => ({
    reply: input.executionResult.outcome === 'no_change'
      ? input.draftReply
      : input.executionResult.committed.map(item => item.receiptSummary).join('\n') || '没有完成更新',
    providerMetadata: { attemptCount: 1, attempts: [], protocolWarnings: [] },
  });

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

  provider = async input => {
    const execution = await input.executeReadTool({
      id: 'read-house-event', name: 'get_event', argumentsJson: JSON.stringify({ event_id: houseEvent.id }),
    });
    assert.equal(execution.result.found, true, '更新已有事件前必须精确读取真实状态');
    return {
      reply: '还款计划继续沿用这条主线。',
      segment: { action: 'continue' },
      operations: [],
      eventDeltas: [{
        key: 'repay-plan',
        target: { action: 'update_existing', eventId: houseEvent.id },
        evidence: ['下个月10号还'],
        state: { action: 'replace', changeType: 'plan', value: '已开始看房；下个月10号继续还款' },
        progress: [{ type: 'decision', content: '确定下个月10号继续还款' }],
        todos: [{
          action: 'create', todoRef: 'todo_1', text: '继续还款',
          dateStatus: 'resolved', dateText: '下个月10号', dueDate: '2026-10-10', timePrecision: 'date',
        }],
      }],
    };
  };
  const modelOnlyEvent = await orchestrator.sendAssistantTurn({
    requestId: 'request-model-only-event', content: '下个月10号还', source: 'text', settings,
    createdAt: new Date('2026-09-15T11:30:00+08:00').getTime(),
  });
  assert.equal(JSON.stringify(modelOnlyEvent.operations.map(item => item.operationType)), JSON.stringify([
    'update_event', 'append_event_update', 'create_todo', 'link_todo_event',
  ]), '完整事件增量必须原子提交状态、进展、待办和自动关联');
  const modelOnlyLog = sqlite.prepare("SELECT * FROM assistant_decision_logs WHERE request_id='request-model-only-event'").get();
  assert.equal(JSON.parse(modelOnlyLog.proposed_event_deltas_json)[0].key, 'repay-plan',
    '日志必须保留模型原始事件增量');
  assert.equal(JSON.stringify(JSON.parse(modelOnlyLog.validation_json).compiled.map(item => item.type)), JSON.stringify([
    'update_event', 'append_event_update', 'create_todo', 'link_todo_event',
  ]), '日志必须记录事件增量编译出的原子操作');

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
    assert.ok(!input.context.contextBlock.includes(`\"id\":\"${hiddenTodo.id}\"`),
      '未精确读取的分段关联待办不得自动进入模型上下文');
    return {
      reply: '先尝试直接修改。',
      segment: { action: 'continue' },
      operations: [{ key: 'date', type: 'update_todo', todoId: hiddenTodo.id, dateStatus: 'resolved', dateText: '周五', dueDate: '2026-09-18', timePrecision: 'date' }],
    };
  };
  const unreadUpdate = await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo-unread', content: '那就周五吧', source: 'text', settings,
    createdAt: new Date('2026-09-15T12:00:00+08:00').getTime(),
  });
  assert.equal(unreadUpdate.operations.length, 0, '未读取详情的已有待办修改必须被本地拒绝');
  assert.equal(sqlite.prepare('SELECT due_at FROM entries WHERE id=?').get(hiddenTodo.id).due_at, null);

  provider = async input => {
    assert.ok(!input.context.contextBlock.includes(`\"id\":\"${hiddenTodo.id}\"`),
      '尚无快照时模型必须通过工具读取待办');
    const execution = await input.executeReadTool({
      id: 'read-hidden-todo', name: 'get_todo', argumentsJson: JSON.stringify({ todo_id: hiddenTodo.id }),
    });
    assert.equal(execution.result.found, true, '精确读取必须拿到待办真实状态');
    return { reply: '这条待办目前还没有日期。', segment: { action: 'continue' }, operations: [] };
  };
  await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo-read', content: '先看一下整理照片这条待办', source: 'text', settings,
    createdAt: new Date('2026-09-15T12:01:00+08:00').getTime(),
  });
  const snapshotSegmentId = (await store.getRequestState('request-hidden-todo-read')).userMessage.segmentId;
  assert.equal((await workingSnapshots.loadValidAssistantWorkingSnapshots(`${snapshotSegmentId}-other`)).length, 0,
    '短期工作快照必须按分段隔离，不能泄漏到其他话题');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM assistant_memories').get().count, 0,
    '工作快照只存在于当前进程，不能升级成“我的”长期记忆');

  provider = async input => {
    assert.ok(input.context.contextBlock.includes(`\"id\":\"${hiddenTodo.id}\"`),
      '同一分段中版本未变化的精确读取结果必须作为有效快照复用');
    return {
      reply: '时间按周六继续安排。',
      segment: { action: 'continue' },
      operations: [{ key: 'date', type: 'update_todo', todoId: hiddenTodo.id, dateStatus: 'resolved', dateText: '周六', dueDate: '2026-09-19', timePrecision: 'date' }],
    };
  };
  await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo-date', content: '那就周六吧', source: 'text', settings,
    createdAt: new Date('2026-09-15T12:02:00+08:00').getTime(),
  });
  assert.ok(sqlite.prepare('SELECT due_at FROM entries WHERE id=?').get(hiddenTodo.id).due_at,
    '日期补充应更新同一条隐藏待办');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM entries WHERE kind='task' AND summary='整理照片'").get().count, 1,
    '补日期不得创建重复待办');

  provider = async input => {
    assert.ok(!input.context.contextBlock.includes(`\"id\":\"${hiddenTodo.id}\"`),
      '待办 revision 变化后旧快照必须自动失效');
    return { reply: '需要时我会重新读取。', segment: { action: 'continue' }, operations: [] };
  };
  await orchestrator.sendAssistantTurn({
    requestId: 'request-hidden-todo-stale', content: '刚才那条待办现在是什么状态', source: 'text', settings,
    createdAt: new Date('2026-09-15T12:03:00+08:00').getTime(),
  });

  sqlite.exec(`CREATE TRIGGER fail_assistant_operation
    BEFORE INSERT ON assistant_operations BEGIN SELECT RAISE(ABORT, 'forced operation failure'); END;`);
  provider = async () => ({
    reply: '这只是自然回复，不能单独保存。',
    segment: { action: 'continue' },
    operations: [{ key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '不应留下的待办', dateStatus: 'absent' }],
    providerMetadata: {
      startedAt: 4900, completedAt: 4950, finishReason: 'stop',
      promptTokens: 10, completionTokens: 5, totalTokens: 15,
      attemptCount: 2,
      attempts: [
        { attempt: 1, startedAt: 4900, completedAt: 4920, errorCode: 'invalid-response', errorDetail: '格式错误', finishReason: 'stop', promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        { attempt: 2, startedAt: 4921, completedAt: 4950, errorCode: null, errorDetail: null, finishReason: 'stop', promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      ],
      protocolWarnings: [],
    },
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
  const rollbackLog = sqlite.prepare("SELECT * FROM assistant_decision_logs WHERE request_id='request-rollback'").get();
  assert.equal(rollbackLog.provider_attempt_count, 2, '事务失败不得覆盖已经记录的模型尝试元数据');
  assert.equal(JSON.parse(rollbackLog.provider_attempts_json).length, 2);

  console.log('assistant turn tests passed');
  sqlite.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
