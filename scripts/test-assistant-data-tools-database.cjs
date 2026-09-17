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
  withExclusiveTransactionAsync: async callback => callback(adapter),
};

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
  const db = load('src/db.ts');
  const tools = load('src/assistant/data-tools.ts');
  await db.initDatabase();
  sqlite.prepare(`INSERT INTO assistant_events
    (id,title,current_state,status,pinned_at,revision,created_at,updated_at)
    VALUES ('event-trip','十一出行','10月1日晚有演出','active',NULL,4,100,400)`).run();
  sqlite.prepare(`INSERT INTO assistant_event_aliases (id,event_id,alias,created_at)
    VALUES ('alias-trip','event-trip','国庆计划',100)`).run();
  sqlite.prepare(`INSERT INTO assistant_event_updates
    (id,event_id,content,occurred_at,source_message_id,stable_key,created_at,undone_at)
    VALUES ('update-trip','event-trip','已购买演出票',300,NULL,'trip-update',300,NULL)`).run();
  sqlite.prepare(`INSERT INTO entries
    (id,raw_text,kind,summary,due_at,remind_at,topic,tags,persons,parse_status,parse_source,corrected_from,created_at,updated_at,revision_at,done,done_at,source)
    VALUES ('todo-train','乘坐火车去哈尔滨','task','10月1日10:39 齐齐哈尔南到哈尔滨',1790812740000,NULL,NULL,'[]','[]','done','assistant',NULL,200,200,200,0,NULL,'assistant')`).run();
  sqlite.prepare(`INSERT INTO assistant_object_relations
    (id,from_type,from_id,relation_type,to_type,to_id,source_message_id,created_at,undone_at)
    VALUES ('relation-trip','todo','todo-train','belongs_to','event','event-trip',NULL,200,NULL)`).run();

  const searched = await tools.executeAssistantReadToolWithDatabase(adapter, {
    id: 'call-search', name: 'search_events', argumentsJson: '{"query":"哈尔滨"}',
  });
  assert.deepEqual([...searched.readEventIds], ['event-trip']);

  const event = await tools.executeAssistantReadToolWithDatabase(adapter, {
    id: 'call-event', name: 'get_event', argumentsJson: '{"event_id":"event-trip"}',
  });
  assert.equal(event.result.event.revision, 4);
  assert.equal(event.result.updates[0].content, '已购买演出票');
  assert.equal(event.result.todos[0].id, 'todo-train');
  assert.deepEqual([...event.readTodoIds], ['todo-train']);

  const todo = await tools.executeAssistantReadToolWithDatabase(adapter, {
    id: 'call-todo', name: 'get_todo', argumentsJson: '{"todo_id":"todo-train"}',
  });
  assert.equal(todo.result.todo.done, false);
  assert.equal(todo.result.events[0].id, 'event-trip');

  const missing = await tools.executeAssistantReadToolWithDatabase(adapter, {
    id: 'call-missing', name: 'get_event', argumentsJson: '{"event_id":"missing"}',
  });
  assert.equal(missing.result.found, false);
  assert.equal(missing.readEventIds.length, 0);
  console.log('assistant data tools database tests passed');
}

void main();

