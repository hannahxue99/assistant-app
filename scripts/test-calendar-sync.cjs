const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const sqlite = new DatabaseSync(':memory:');
let failLinkWrite = false, granted = true, createCount = 0, updateHook;
const events = new Map();
const calendar = { id: 'owned', allowsModifications: true, sourceId: 'source',
  listEvents: async () => [...events.values()],
  createEvent: async data => {
    createCount++;
    const event = { ...data, id: `event-${createCount}`, calendarId: 'owned',
      async update(next) { Object.assign(this, next); if (updateHook) await updateHook(); },
      async delete() { events.delete(this.id); },
    };
    events.set(event.id, event); return event;
  },
};
const native = {
  EntityTypes: { EVENT: 'event' }, getCalendarPermissions: async () => ({ granted }),
  requestCalendarPermissions: async () => ({ granted }), getCalendars: async () => [calendar],
  ExpoCalendarEvent: { get: async id => { if (events.has(id)) return events.get(id); throw Object.assign(new Error('missing'), { code: 'ERR_EVENT_NOT_FOUND' }); } },
};
const adapter = {
  execAsync: async sql => sqlite.exec(sql),
  getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  runAsync: async (sql, ...args) => {
    if (failLinkWrite && sql.startsWith('UPDATE calendar_links SET event_id')) throw new Error('disk failed');
    return sqlite.prepare(sql).run(...args);
  },
  withExclusiveTransactionAsync: async callback => {
    sqlite.exec('BEGIN');
    try { await callback(adapter); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, Promise, Set, Map, console, encodeURIComponent,
    require(name) {
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => ({}) };
      if (name === 'expo-calendar') return native;
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
    },
  }, { filename: file }); return exports;
}
async function main() {
  const db = load('src/db.ts'); const sync = load('src/engine/calendar-sync.ts');
  const { calendarProjection, inferTimePrecision, editedDueTime } = load('src/engine/calendar-projection.ts');
  await db.initDatabase();
  const due = new Date(); due.setDate(due.getDate() + 2); due.setHours(9, 0, 0, 0);
  const task = await db.insertEntry({ rawText: '买牛肉', source: 'text' }, { kind: 'task', summary: '买牛肉', dueAt: +due });
  await sync.syncCalendar(); assert.equal(events.size, 0, '默认关闭不得写日历');
  await db.runSql("UPDATE calendar_config SET enabled=1,calendar_id='owned' WHERE id=1");
  failLinkWrite = true; await sync.syncCalendar();
  assert.equal(events.size, 1); assert.ok((await sync.calendarStatus()).pending, '创建后落库失败保留任务');
  failLinkWrite = false; await sync.syncCalendar(true);
  assert.equal(createCount, 1, '重试找回同一事件而非重复创建');
  const event = [...events.values()][0];
  assert.equal(event.allDay, true, '默认9点必须是全天');
  assert.equal(new Date(event.startDate).getHours(), 0);
  const allDayEnd = new Date(event.endDate);
  assert.equal(allDayEnd.toDateString(), new Date(event.startDate).toDateString(), '全天日程不得跨到次日');
  assert.equal(allDayEnd.getHours(), 23);
  await db.applyCorrection(task.id, { summary: '买葡萄' }); await sync.syncCalendar();
  assert.equal(events.size, 1); assert.equal(event.title, '买葡萄');
  await db.setDone(task.id, true); await sync.syncCalendar(); assert.equal(event.title, '✓ 买葡萄');
  await db.setDone(task.id, false); await sync.syncCalendar(); assert.equal(event.title, '买葡萄');
  granted = false; await db.applyCorrection(task.id, { summary: '买苹果' }); await sync.syncCalendar();
  assert.equal(event.title, '买葡萄'); assert.ok((await sync.calendarStatus()).pending);
  granted = true; await sync.syncCalendar(true); assert.equal(event.title, '买苹果');
  updateHook = async () => { updateHook = null; await db.applyCorrection(task.id, { summary: '并发新修改' }); };
  await db.applyCorrection(task.id, { summary: '较早修改' }); await sync.syncCalendar();
  assert.ok((await sync.calendarStatus()).pending, '旧结果不能清除新版本任务');
  await sync.syncCalendar(); assert.equal(event.title, '并发新修改');
  await sync.setCalendarEnabled(false); await db.deleteEntry(task.id); await sync.syncCalendar();
  assert.equal(events.size, 1, '关闭后停止删除');
  await sync.setCalendarEnabled(true); await sync.syncCalendar();
  assert.equal(events.size, 0, '关闭期间删除的墓碑在重新开启后补偿');
  const historical = await db.insertEntry({ rawText: '历史', source: 'text' }, { kind: 'task', dueAt: 1000 });
  await sync.syncCalendar(); assert.equal(events.size, 0, '不导出历史逾期');
  const clock = new Date(due); clock.setHours(15);
  assert.equal(new Date(editedDueTime(task, task.summary, '下午3点看牙医', +due)).getHours(), 15);
  assert.equal(inferTimePrecision('下午3点看牙医', +clock), 'dateTime');
  const timed = calendarProjection({ ...historical, dueAt: +clock, timePrecision: 'dateTime' }, 'test');
  assert.equal(timed.allDay, false); assert.equal(+timed.endDate - +timed.startDate, 3600000);
  const monthEnd = calendarProjection({ ...historical, dueAt: +new Date(2026, 8, 30, 9), timePrecision: 'date' }, 'test');
  assert.equal(new Date(monthEnd.endDate).getMonth(), 8, '月末全天日程不得显示到次月');
  sqlite.exec('BEGIN'); sqlite.prepare('UPDATE entries SET summary=? WHERE id=?').run('回滚', historical.id); sqlite.exec('ROLLBACK');
  assert.equal((await sync.calendarStatus()).pending, 0, '记录回滚时队列也回滚');
  sqlite.close(); console.log('Calendar integration passed: ownership, dedup, all-day, time, CRUD, permission, crash recovery, version race, disabled deletion, rollback.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
