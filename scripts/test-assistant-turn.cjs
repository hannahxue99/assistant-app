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
let provider = async () => ({ reply: '默认回复', segment: { action: 'continue' } });
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
  release({ reply: '好，我们继续。', segment: { action: 'continue', summary: '用户继续讨论照片整理。' } });
  const completed = await first;
  assert.equal(completed.assistantMessage.content, '好，我们继续。');

  provider = async () => { throw Object.assign(new Error('offline'), { code: 'network' }); };
  await assert.rejects(orchestrator.sendAssistantTurn({
    requestId: 'request-2', content: '断网时也要保存', source: 'text', settings, createdAt: 2000,
  }), /offline/);
  const failed = (await store.listMessages({ limit: 20 })).find(item => item.requestId === 'request-2');
  assert.equal(failed.status, 'failed', '模型失败后原话应保留为可重试');

  provider = async () => ({ reply: '网络恢复了。', segment: { action: 'continue' } });
  const retried = await orchestrator.retryAssistantTurn({ requestId: 'request-2', settings });
  assert.equal(retried.assistantMessage.content, '网络恢复了。');
  assert.equal((await store.listMessages({ limit: 20 })).filter(item => item.requestId === 'request-2').length, 2,
    '重试应复用用户消息，只新增一条助手回复');

  provider = async () => ({
    reply: '我们换到新话题。',
    segment: { action: 'split_before_user', previousSummary: '照片整理讨论结束。', summary: '开始讨论旅行。' },
  });
  await orchestrator.sendAssistantTurn({
    requestId: 'request-3', content: '说说下次旅行吧', source: 'text', settings, createdAt: 3000,
  });
  const segments = sqlite.prepare('SELECT * FROM conversation_segments ORDER BY started_at').all();
  assert.equal(segments.filter(item => item.status === 'current').length, 1, '始终只能有一个当前分段');
  assert.ok(segments.some(item => item.status === 'closed' && item.summary === '照片整理讨论结束。'),
    '切换话题必须关闭旧分段并保存最终摘要');

  console.log('assistant turn tests passed');
  sqlite.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
