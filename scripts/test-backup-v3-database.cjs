const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
let failPattern = null;
const adapter = {
  execAsync: async sql => sqlite.exec(sql),
  getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  runAsync: async (sql, ...args) => {
    if (failPattern && sql.includes(failPattern)) {
      failPattern = null;
      throw new Error('injected backup v3 write failure');
    }
    return sqlite.prepare(sql).run(...args);
  },
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

function count(table) {
  return Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function clearFacts() {
  sqlite.exec(`
    DELETE FROM assistant_reasoning;
    DELETE FROM assistant_operations;
    DELETE FROM assistant_object_relations;
    DELETE FROM assistant_memory_sources;
    UPDATE assistant_memories SET superseded_by_id=NULL;
    DELETE FROM assistant_memories;
    DELETE FROM assistant_event_updates;
    DELETE FROM assistant_event_aliases;
    DELETE FROM assistant_events;
    DELETE FROM assistant_messages;
    DELETE FROM assistant_requests;
    DELETE FROM conversation_segments;
    DELETE FROM entries;
    DELETE FROM topic_preferences;
    DELETE FROM assistant_import_conflicts;
    DELETE FROM assistant_projection_jobs;
    UPDATE profile SET name='',goals='[]',avoid='[]',notify_morning=1,notify_evening=1 WHERE id=1;
  `);
}

async function main() {
  const db = load('src/db.ts');
  await db.initDatabase();
  const backup = load('src/engine/backup-v3-database.ts');
  const format = load('src/engine/backup-v3-format.ts');

  const entry = {
    id: 'todo-1', rawText: '明天交报告', kind: 'task', summary: '交报告', dueAt: 2000,
    timePrecision: 'dateTime', remindAt: 1900, topic: '工作', tags: ['报告'], persons: [],
    parseStatus: 'ok', parseSource: 'llm', correctedFrom: null, createdAt: 1000,
    updatedAt: 1000, revisionAt: 1000, done: 0, doneAt: null, source: 'text',
  };
  sqlite.prepare(`INSERT INTO entries (
    id,raw_text,kind,summary,due_at,time_precision,remind_at,topic,tags,persons,parse_status,
    parse_source,corrected_from,created_at,updated_at,revision_at,done,done_at,source
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    entry.id, entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.timePrecision,
    entry.remindAt, entry.topic, JSON.stringify(entry.tags), JSON.stringify(entry.persons),
    entry.parseStatus, entry.parseSource, entry.correctedFrom, entry.createdAt, entry.updatedAt,
    entry.revisionAt, entry.done, entry.doneAt, entry.source,
  );
  sqlite.exec(`
    UPDATE profile SET name='小雪',goals='["规律生活"]',avoid='["熬夜"]',notify_evening=0 WHERE id=1;
    UPDATE settings SET llm_key='never-export-key',llm_base_url='https://secret.example/v1' WHERE id=1;
    INSERT INTO topic_preferences VALUES ('工作',1100);
    INSERT INTO conversation_segments VALUES ('segment-1','报告安排','current',1000,NULL,1500);
    INSERT INTO assistant_requests VALUES ('request-1','message-user-1','pending',NULL,1,1200,1500);
    INSERT INTO assistant_messages VALUES ('message-user-1','request-1','user','帮我安排报告','text','sending','segment-1',NULL,'{}',1200,1200);
    INSERT INTO assistant_messages VALUES ('message-assistant-1','request-1','assistant','已经安排。','assistant','saved','segment-1',NULL,'{"thinkingMs":200}',1500,1500);
    INSERT INTO assistant_reasoning VALUES ('request-1','private reasoning',1200,1400,1400);
    INSERT INTO assistant_events VALUES ('event-1','报告','撰写中','active',NULL,1,1300,1500);
    INSERT INTO assistant_event_aliases VALUES ('alias-1','event-1','季度报告',1300);
    INSERT INTO assistant_event_updates VALUES ('update-1','event-1','已建立待办',1400,'message-user-1','request-1:update-1',1400,NULL);
    INSERT INTO assistant_object_relations VALUES ('relation-1','todo','todo-1','belongs_to','event','event-1','message-user-1',1400,NULL);
    INSERT INTO assistant_memories VALUES ('memory-1','preference','先列提纲','先列提纲','active','ordinary','explicit',NULL,1,1250,1250,1250,NULL,NULL);
    INSERT INTO assistant_memory_sources VALUES ('memory-source-1','memory-1','message-user-1','先列提纲',1250);
  `);
  sqlite.prepare(`INSERT INTO assistant_operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'operation-1', 'request-1', 'todo', 'create_todo', 'todo', 'todo-1', null,
    JSON.stringify(entry), '建立待办：交报告', 'committed', 0, 1400, null,
  );

  const markdown = await backup.exportBackupV3Markdown();
  const envelope = format.parseBackupV3Markdown(markdown);
  assert.equal(envelope.payload.entries.length, 1);
  assert.equal(envelope.payload.assistantMessages.length, 2);
  assert.equal(envelope.payload.events.length, 1);
  assert.equal(envelope.payload.objectRelations.length, 1);
  assert.equal(envelope.payload.operations.length, 1);
  assert.equal(envelope.payload.memories.length, 1);
  assert.equal(envelope.payload.assistantRequests[0].status, 'failed');
  assert.equal(envelope.payload.assistantRequests[0].errorCode, 'interrupted_at_export');
  assert.equal(envelope.payload.assistantMessages.find(item => item.role === 'user').status, 'failed');
  assert.ok(!markdown.includes('never-export-key'));
  assert.ok(!markdown.includes('https://secret.example/v1'));
  assert.ok(!markdown.includes('private reasoning'));

  clearFacts();
  const preview = await backup.previewBackupV3Import(envelope.payload);
  assert.ok(preview.added > 0);
  const result = await backup.importBackupV3(envelope);
  assert.equal(result.operationSkipped, 0);
  assert.equal(count('entries'), 1);
  assert.equal(count('assistant_messages'), 2);
  assert.equal(count('assistant_events'), 1);
  assert.equal(count('assistant_object_relations'), 1);
  assert.equal(count('assistant_operations'), 1);
  assert.equal(count('assistant_memories'), 1);
  assert.equal(count('assistant_projection_jobs'), 0, 'FTS projection job should clear after success');

  const repeated = await backup.importBackupV3(envelope);
  assert.equal(repeated.added, 0);
  assert.equal(count('entries'), 1);
  assert.equal(count('assistant_messages'), 2);

  clearFacts();
  const localEntry = { ...entry, summary: '本地较新', revisionAt: 5000, updatedAt: 5000 };
  sqlite.prepare(`INSERT INTO entries (
    id,raw_text,kind,summary,due_at,time_precision,remind_at,topic,tags,persons,parse_status,
    parse_source,corrected_from,created_at,updated_at,revision_at,done,done_at,source
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    localEntry.id, localEntry.rawText, localEntry.kind, localEntry.summary, localEntry.dueAt,
    localEntry.timePrecision, localEntry.remindAt, localEntry.topic, JSON.stringify(localEntry.tags),
    JSON.stringify(localEntry.persons), localEntry.parseStatus, localEntry.parseSource,
    localEntry.correctedFrom, localEntry.createdAt, localEntry.updatedAt, localEntry.revisionAt,
    localEntry.done, localEntry.doneAt, localEntry.source,
  );
  const conflictResult = await backup.importBackupV3(envelope);
  assert.ok(conflictResult.conflicts > 0);
  assert.equal(sqlite.prepare('SELECT summary FROM entries WHERE id=?').get('todo-1').summary, '本地较新');
  assert.ok(count('assistant_import_conflicts') > 0);

  clearFacts();
  const before = ['entries', 'assistant_events', 'assistant_messages'].map(count);
  failPattern = 'INSERT INTO assistant_events';
  await assert.rejects(() => backup.importBackupV3(envelope), /injected backup v3 write failure/);
  assert.deepEqual(['entries', 'assistant_events', 'assistant_messages'].map(count), before,
    'write failure must roll back every fact');
  assert.equal(count('assistant_import_conflicts'), 0);

  sqlite.exec(`INSERT INTO assistant_requests VALUES ('orphan-request','missing-message','failed','broken',1,1,1)`);
  await assert.rejects(() => backup.exportBackupV3Markdown(), /缺少用户消息/);

  console.log('Complete backup V3 database tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
