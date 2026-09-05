const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const sqlite = new DatabaseSync(':memory:');
let rejectQueue = false;
const adapter = {
  execAsync: async sql => sqlite.exec(sql),
  getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  runAsync: async (sql, ...args) => {
    if (rejectQueue && sql.includes('INSERT INTO notification_sync_queue')) throw new Error('queue write failed');
    return sqlite.prepare(sql).run(...args);
  },
  withExclusiveTransactionAsync: async callback => {
    sqlite.exec('BEGIN');
    try { await callback(adapter); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
let llm = async () => ({ kind: 'task', summary: '9月6日买牛肉', topic: '采购', tags: [], persons: [] });
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, Promise, Set, Map, console,
    require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts';
      if (resolved === 'src/engine/notifications.ts') return { syncEntryReminder: async () => {} };
      if (resolved === 'src/engine/llm.ts') return { understandWithLlm: (...args) => llm(...args) };
      return load(resolved);
    },
  }, { filename: file });
  return exports;
}
async function main() {
  const db = load('src/db.ts');
  const engine = load('src/engine/understand.ts');
  const createdAt = new Date(2026, 8, 5, 10).getTime();
  const settings = { llmEnabled: true, llmKey: 'fixture' };
  await db.initDatabase();
  assert.equal(await db.countEntries(), 0, '新库不自动注入个人记录');
  const create = async () => db.insertEntry({ rawText: '明天买牛肉', source: 'text', createdAt });
  const old = await create();
  let captured;
  llm = async (text, config) => {
    captured = config;
    return { kind: 'task', summary: '9月20日买牛肉', topic: '采购', tags: [], persons: [] };
  };
  await engine.understandEntry(old, settings);
  const parsed = await db.getEntry(old.id);
  assert.equal(captured.referenceAt, createdAt);
  assert.equal(new Date(parsed.dueAt).getDate(), 6);
  assert.equal(parsed.summary, '9月6日买牛肉', '错误的模型具体日期应回退到正确规则标题');

  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  llm = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const pending = await create();
  const job = engine.understandEntry(pending, settings);
  assert.equal(engine.understandEntry(pending, settings), job, '同一条不得并发请求');
  await ready;
  await db.applyCorrection(pending.id, { summary: '我的标题', rawText: '9月7日买牛肉' });
  release({ kind: 'task', summary: '旧标题', topic: '旧主题', tags: [], persons: [] });
  assert.equal(await job, 'stale');
  assert.equal((await db.getEntry(pending.id)).summary, '我的标题');
  assert.equal(new Date((await db.getEntry(pending.id)).dueAt).getDate(), 7);

  const renamedSnapshot = await db.getEntry(old.id);
  await db.renameTopic('采购', '家庭采购');
  assert.equal(await db.updateParsedResult(old.id, {
    kind: 'task', summary: '旧结果', dueAt: parsed.dueAt, topic: '采购', tags: [], persons: [],
  }, 'rule', renamedSnapshot, 'failed'), false, '失败降级也不能覆盖新主题');
  assert.equal((await db.getEntry(old.id)).topic, '家庭采购');

  await db.setDone(old.id, true);
  await db.applyCorrection(old.id, { rawText: '9月7日买牛肉' });
  const edited = await db.getEntry(old.id);
  assert.equal(edited.topic, '家庭采购');
  assert.equal(edited.done, 1);
  assert.equal(edited.summary, '9月7日买牛肉');
  await db.applyCorrection(old.id, { summary: '手工标题' });
  assert.equal((await db.getEntry(old.id)).dueAt, edited.dueAt);
  await db.applyCorrection(old.id, { rawText: '买牛肉' });
  assert.equal((await db.getEntry(old.id)).dueAt, null);
  assert.equal((await db.getEntry(old.id)).kind, 'task');

  const before = await db.getEntry(old.id);
  rejectQueue = true;
  await assert.rejects(db.applyCorrection(old.id, { rawText: '9月8日买水果' }), /queue write failed/);
  rejectQueue = false;
  assert.equal((await db.getEntry(old.id)).rawText, before.rawText, '补偿写入失败时内容一起回滚');
  assert.equal((await db.listEntries({ query: '买水果', showDone: true })).length, 0, 'FTS 也回滚');

  const interrupted = await create();
  assert.ok((await db.listParseFailed()).some(e => e.id === interrupted.id));
  let calls = 0;
  llm = async () => { calls++; return { kind: 'task', summary: '9月6日买牛肉', topic: '采购', tags: [], persons: [] }; };
  await engine.retryFailedUnderstandings(settings);
  assert.ok(calls > 0);
  assert.equal((await db.getEntry(interrupted.id)).parseStatus, 'ok');

  const pinned = await db.insertEntry({ rawText: '旧置顶记录', source: 'text', createdAt: 1000 }, {
    topic: '旧置顶', summary: '旧置顶记录',
  });
  await db.setTopicPinned('旧置顶', true);
  for (let i = 0; i < 205; i++) {
    await db.insertEntry({ rawText: `新记录${i}`, source: 'text', createdAt: createdAt + i }, {
      topic: '大量记录', summary: `新记录${i}`,
    });
  }
  let groups = await db.listTopicGroups();
  assert.equal(groups[0].topic, '旧置顶', '超过200条新记录后旧置顶仍排第一');
  assert.equal(groups[0].latest.id, pinned.id);
  assert.equal(groups.find(g => g.topic === '大量记录').count, 205);
  assert.equal(groups.find(g => g.topic === '大量记录').latest.summary, '新记录204');
  assert.equal((await db.listByTopic('大量记录')).length, 205, '卡片与详情条数一致');
  for (let i = 0; i < 205; i++) {
    await db.insertEntry({ rawText: `主题记录${i}`, source: 'text' }, { topic: `主题${i}` });
  }
  groups = await db.listTopicGroups();
  assert.ok(groups.length > 200, '主题本身也不受原声200条截断');
  assert.equal(groups[0].topic, '旧置顶');
  console.log('聚合规模测试通过：空库、205条同主题、205个主题、旧置顶与详情计数');
  console.log('一致性集成测试通过：日期、模型竞争、编辑衍生、事务回滚、pending恢复');
  sqlite.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
