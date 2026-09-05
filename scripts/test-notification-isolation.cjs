// 执行真实 notifications / understand 模块，以替身模拟 SQLite 和原生通知故障。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Date, Promise, Set, Map,
    console: { log() {}, warn() {} },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return exports;
}
async function main() {
  let saved;
  let queued = 0;
  let llmCalls = 0;
  const db = {
    queueNotificationSync: async () => { queued++; },
    getProfile: async () => ({}), listOpenTasks: async () => [],
    listActiveTopics: async () => [],
    insertEntry: async (input, parsed) => (saved = { ...input, ...parsed, id: 'entry-1', done: 0 }),
    getEntry: async () => saved,
    updateParsedResult: async (id, parsed, source) => { saved = { ...saved, ...parsed, parseSource: source }; return true; },
    setParseStatus: async (id, status) => { saved.parseStatus = status; },
  };
  const notifications = load('src/engine/notifications.ts', {
    'expo-notifications': {
      getPermissionsAsync: async () => ({ status: 'granted' }),
      scheduleNotificationAsync: async () => { throw new Error('native scheduling failed'); },
      cancelScheduledNotificationAsync: async () => { throw new Error('native cancellation failed'); },
      getAllScheduledNotificationsAsync: async () => { throw new Error('native listing failed'); },
      SchedulableTriggerInputTypes: { DATE: 'date' },
    },
    'react-native': { Platform: { OS: 'android' } },
    '../db': db,
    './notification-copy': {},
  });
  const understand = load('src/engine/understand.ts', {
    '../db': db,
    './time': {
      hasTimeHint: () => true,
      parseChineseTime: () => ({ dueAt: Date.now() + 3600000 }),
      extractRelativeDateExpression: () => null,
    },
    './llm': { understandWithLlm: async () => {
      llmCalls++;
      return { kind: 'task', summary: '模型标题', topic: '家庭采购', tags: [], persons: [] };
    } },
    './notifications': notifications,
    './entry-events': { notifyEntryChanges() {} },
  });
  const settings = { llmEnabled: true, llmKey: 'test-only' };
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  await understand.ingest({ rawText: '买水果', source: 'text' }, settings, finish);
  await finished;
  assert.equal(llmCalls, 1, '提醒失败后仍调用模型');
  assert.equal(saved.topic, '家庭采购', '提醒失败不得抹掉模型主题');
  assert.equal(saved.parseSource, 'llm', '提醒失败不得触发规则降级');
  assert.ok(queued >= 2, '初次保存与理解回填均留下补偿意图');
  await notifications.syncEntryReminder({ ...saved, done: 1 });
  assert.equal(saved.topic, '家庭采购', '取消提醒失败也不影响记录');
  console.log('通知异常隔离：新增 → LLM 回填 → 完成，5项断言通过');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
