import * as SQLite from 'expo-sqlite';
import type {
  BackupEnvelope,
  BackupPayload,
  Entry,
  EntryFilter,
  EntryKind,
  NewEntryInput,
  Profile,
  Settings,
  TopicGroup,
  TopicPreference,
} from './types';
import { buildImportableMarkdown } from './engine/backup-format';
import {
  buildImportDecisions,
  isDefaultProfile,
  summarizeImport,
  type ImportPreview,
  type ImportResult,
} from './engine/import-merge';
import { sortTopicGroups } from './engine/topic-order';
import { deriveEditedEntry } from './engine/edit-derived';
import { calendarSchema } from './engine/calendar-schema';
import { inferTimePrecision } from './engine/calendar-projection';
import { runSingleFlight, type SingleFlightState } from './engine/single-flight';

type DatabaseGlobal = typeof globalThis & {
  __assistantDatabaseRuntime?: SingleFlightState<SQLite.SQLiteDatabase>;
};

const databaseGlobal = globalThis as DatabaseGlobal;
const databaseRuntime = databaseGlobal.__assistantDatabaseRuntime ??= {
  value: null,
  pending: null,
};

const DEFAULT_SETTINGS: Settings = {
  llmEnabled: false,
  llmBaseUrl: 'https://api.deepseek.com/v1',
  llmKey: '',
  llmModel: 'deepseek-chat',
};

const DEFAULT_PROFILE: Profile = {
  name: '',
  goals: [],
  avoid: [],
  notifyMorning: true,
  notifyEvening: true,
};

/** 初始化数据库：建表 + FTS trigram + 种子数据 */
export async function initDatabase(): Promise<void> {
  await runSingleFlight(databaseRuntime, initializeDatabase);
}

async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  // Expo 57 的预关闭清理会枚举到 FTS5 内部语句；随后 FTS5 自行清理时可能重复释放。
  // runAsync/get*Async 已用 finally 释放业务语句；将索引内部资源留给 SQLite 管理。
  // 独占事务创建的连接会继承此选项。修改后必须完整 Reload，不能仅 Fast Refresh。
  const database = await SQLite.openDatabaseAsync('assistant.db', {
    finalizeUnusedStatementsBeforeClosing: false,
  });
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'info',
      summary TEXT NOT NULL,
      due_at INTEGER,
      remind_at INTEGER,
      topic TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      persons TEXT NOT NULL DEFAULT '[]',
      parse_status TEXT NOT NULL DEFAULT 'pending',
      parse_source TEXT,
      corrected_from TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      revision_at INTEGER,
      done INTEGER NOT NULL DEFAULT 0,
      done_at INTEGER,
      source TEXT NOT NULL DEFAULT 'text'
    );
    CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_entries_due ON entries(due_at);
    CREATE INDEX IF NOT EXISTS idx_entries_topic ON entries(topic);
    CREATE INDEX IF NOT EXISTS idx_entries_kind ON entries(kind);

    -- 中文全文搜索：trigram tokenizer（SQLite ≥3.34，Expo 内置支持）
    -- entry_id 用于关联主表（UNINDEXED 不参与索引）；写入路径经 syncFts 增量维护，
    -- 启动不做全量重建（旧库如需手动重建可调用 rebuildFts）
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      entry_id UNINDEXED, summary, raw_text, tags,
      tokenize='trigram'
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT '',
      goals TEXT NOT NULL DEFAULT '[]',
      avoid TEXT NOT NULL DEFAULT '[]',
      notify_morning INTEGER NOT NULL DEFAULT 1,
      notify_evening INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO profile (id, name, goals, avoid, notify_morning, notify_evening)
      VALUES (1, '', '[]', '[]', 1, 1);

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      llm_enabled INTEGER NOT NULL DEFAULT 0,
      llm_base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com/v1',
      llm_key TEXT NOT NULL DEFAULT '',
      llm_model TEXT NOT NULL DEFAULT 'deepseek-chat'
    );
    INSERT OR IGNORE INTO settings (id) VALUES (1);

    -- 主题级展示偏好独立保存，避免把置顶状态重复写入每条原声。
    CREATE TABLE IF NOT EXISTS topic_preferences (
      topic TEXT PRIMARY KEY,
      pinned_at INTEGER
    );

    -- 导入发生冲突时保留两侧快照，避免自动取新版本后无法追溯。
    CREATE TABLE IF NOT EXISTS import_conflicts (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      local_snapshot TEXT NOT NULL,
      incoming_snapshot TEXT NOT NULL,
      winner TEXT NOT NULL,
      reason TEXT NOT NULL,
      imported_at INTEGER NOT NULL,
      source_exported_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_import_conflicts_entry ON import_conflicts(entry_id);

    -- 数据已导入但本地提醒尚未重建时保留队列，启动后自动补偿。
    CREATE TABLE IF NOT EXISTS notification_sync_queue (
      entry_id TEXT PRIMARY KEY,
      queued_at INTEGER NOT NULL
    );

    -- 回退旧版规则主题：LLM 未成功理解的记录应保持无主题。
    -- 仅清理规则层曾自动生成的三个固定名称，不影响 LLM 或手动主题。
    UPDATE entries SET topic = NULL
    WHERE parse_source = 'rule'
      AND topic IN ('待办事项', '想法记录', '日常信息');

  `);

  // 旧版本只有 created_at。先探测列再迁移，避免重复 ALTER 导致启动失败。
  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(entries)');
  if (!columns.some((column) => column.name === 'updated_at')) {
    await database.execAsync('ALTER TABLE entries ADD COLUMN updated_at INTEGER;');
  }
  if (!columns.some((column) => column.name === 'revision_at')) {
    await database.execAsync('ALTER TABLE entries ADD COLUMN revision_at INTEGER;');
  }
  if (!columns.some((column) => column.name === 'time_precision')) {
    await database.execAsync('ALTER TABLE entries ADD COLUMN time_precision TEXT;');
    const legacy = await database.getAllAsync<any>('SELECT id,raw_text,due_at FROM entries');
    for (const row of legacy) await database.runAsync('UPDATE entries SET time_precision=? WHERE id=?',
      inferTimePrecision(row.raw_text, row.due_at), row.id);
  }
  await database.execAsync(calendarSchema);
  // A development build may already have created the queue before retry_at was added.
  // Keep startup compatible with that intermediate schema instead of failing every query.
  const calendarJobColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(calendar_jobs)');
  if (!calendarJobColumns.some((column) => column.name === 'retry_at')) {
    await database.execAsync('ALTER TABLE calendar_jobs ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;');
  }
  await database.execAsync(`
    UPDATE entries SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE entries SET revision_at = updated_at WHERE revision_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at);
  `);
  return database;
}

/** 供引擎层（如迁移）使用的薄查询助手 */
export async function queryFirst<T = any>(sql: string, ...args: any[]): Promise<T | null> {
  return (await getDb()).getFirstAsync<T>(sql, ...args);
}

/** 供引擎层使用的执行助手 */
export async function runSql(sql: string, ...args: any[]): Promise<void> {
  await (await getDb()).runAsync(sql, ...args);
}

export async function queryAll<T>(sql: string, ...args: any[]): Promise<T[]> {
  return (await getDb()).getAllAsync<T>(sql, ...args);
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return runSingleFlight(databaseRuntime, initializeDatabase);
}

/** 保存通知补偿意图；通知不可用不影响已保存的记录。 */
export async function queueNotificationSync(entryId: string): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO notification_sync_queue (entry_id, queued_at) VALUES (?, ?)
     ON CONFLICT(entry_id) DO UPDATE SET queued_at=excluded.queued_at`,
    entryId, Date.now(),
  );
}

/* ---------------- Entry CRUD ---------------- */

function rowToEntry(r: any): Entry {
  return {
    id: r.id,
    rawText: r.raw_text,
    kind: r.kind as EntryKind,
    summary: r.summary,
    dueAt: r.due_at,
    timePrecision: r.time_precision ?? inferTimePrecision(r.raw_text, r.due_at),
    remindAt: r.remind_at,
    topic: typeof r.topic === 'string' && r.topic.trim() ? r.topic.trim() : null,
    tags: safeParse(r.tags),
    persons: safeParse(r.persons),
    parseStatus: r.parse_status,
    parseSource: r.parse_source,
    correctedFrom: r.corrected_from,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    revisionAt: r.revision_at ?? r.updated_at ?? r.created_at,
    done: r.done,
    doneAt: r.done_at,
    source: r.source,
  };
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function rowToProfile(r: any): Profile {
  if (!r) return DEFAULT_PROFILE;
  return {
    name: r.name,
    goals: safeParse(r.goals),
    avoid: safeParse(r.avoid),
    notifyMorning: !!r.notify_morning,
    notifyEvening: !!r.notify_evening,
  };
}

async function insertImportedEntry(d: SQLite.SQLiteDatabase, entry: Entry): Promise<void> {
  await d.runAsync(
    `INSERT INTO entries (
       id, raw_text, kind, summary, due_at, remind_at, topic, tags, persons,
       parse_status, parse_source, corrected_from, created_at, updated_at, revision_at,
       done, done_at, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id, entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.remindAt,
    entry.topic, JSON.stringify(entry.tags), JSON.stringify(entry.persons),
    entry.parseStatus, entry.parseSource, entry.correctedFrom, entry.createdAt,
    entry.updatedAt, entry.revisionAt, entry.done, entry.doneAt, entry.source,
  );
  await d.runAsync('UPDATE entries SET time_precision=? WHERE id=?',
    entry.timePrecision ?? inferTimePrecision(entry.rawText, entry.dueAt), entry.id);
}

async function updateImportedEntry(d: SQLite.SQLiteDatabase, entry: Entry): Promise<void> {
  await d.runAsync(
    `UPDATE entries SET
       raw_text=?, kind=?, summary=?, due_at=?, remind_at=?, topic=?, tags=?, persons=?,
       parse_status=?, parse_source=?, corrected_from=?, created_at=?, updated_at=?, revision_at=?,
       done=?, done_at=?, source=?
     WHERE id=?`,
    entry.rawText, entry.kind, entry.summary, entry.dueAt, entry.remindAt, entry.topic,
    JSON.stringify(entry.tags), JSON.stringify(entry.persons), entry.parseStatus,
    entry.parseSource, entry.correctedFrom, entry.createdAt, entry.updatedAt,
    entry.revisionAt, entry.done, entry.doneAt, entry.source, entry.id,
  );
  await d.runAsync('UPDATE entries SET time_precision=? WHERE id=?',
    entry.timePrecision ?? inferTimePrecision(entry.rawText, entry.dueAt), entry.id);
}

async function rebuildFtsWithDatabase(d: SQLite.SQLiteDatabase): Promise<void> {
  await d.runAsync('DELETE FROM entries_fts');
  const rows = await d.getAllAsync<any>('SELECT * FROM entries');
  for (const r of rows) {
    const entry = rowToEntry(r);
    await d.runAsync(
      `INSERT INTO entries_fts (entry_id, summary, raw_text, tags) VALUES (?, ?, ?, ?)`,
      entry.id, entry.summary, entry.rawText, entry.tags.join(' '),
    );
  }
}

/** 创建条目。若已带理解结果可一并写入；否则 parseStatus=pending */
export async function insertEntry(input: NewEntryInput, parsed?: {
  kind?: EntryKind; summary?: string; dueAt?: number | null;
  tags?: string[]; topic?: string | null; persons?: string[];
}): Promise<Entry> {
  const d = await getDb();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = input.createdAt ?? Date.now();
  const kind = parsed?.kind ?? 'info';
  const summary = parsed?.summary ?? input.rawText;
  const dueAt = parsed?.dueAt ?? null;
  const tags = parsed?.tags ?? [];
  const topic = parsed?.topic?.trim() || null;
  const persons = parsed?.persons ?? [];
  const parseStatus = parsed ? 'ok' : 'pending';
  const parseSource = parsed ? 'rule' : null;

  await d.runAsync(
    `INSERT INTO entries (id, raw_text, kind, summary, due_at, remind_at, topic, tags, persons,
       parse_status, parse_source, created_at, updated_at, revision_at, done, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id, input.rawText, kind, summary, dueAt, dueAt, topic,
    JSON.stringify(tags), JSON.stringify(persons),
    parseStatus, parseSource, createdAt, createdAt, createdAt, input.source,
  );
  await syncFts(id);
  return (await getEntry(id))!;
}

/** 批量插入（供测试/恢复） */
export async function insertEntries(items: NewEntryInput[]): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const it of items) out.push(await insertEntry(it));
  return out;
}

export async function getEntry(id: string): Promise<Entry | null> {
  const d = await getDb();
  const r = await d.getFirstAsync<any>('SELECT * FROM entries WHERE id = ?', id);
  return r ? rowToEntry(r) : null;
}

/** 更新理解结果（异步理解完成后回填） */
export async function updateParsedResult(
  id: string,
  parsed: { kind: EntryKind; summary: string; dueAt: number | null; tags: string[]; topic: string | null; persons: string[] },
  parseSource: 'rule' | 'llm',
  expected: Entry,
  status: 'ok' | 'failed' = 'ok',
): Promise<boolean> {
  const d = await getDb();
  let applied = false;
  await d.withExclusiveTransactionAsync(async (txn) => {
  const result = await txn.runAsync(
    `UPDATE entries SET kind=?, summary=?, due_at=?, remind_at=?, topic=?, tags=?, persons=?,
       parse_status=?, parse_source=?, revision_at=MAX(revision_at+1, ?)
     WHERE id=? AND revision_at=? AND raw_text=? AND parse_status!='manual'`,
    parsed.kind, parsed.summary, parsed.dueAt, parsed.dueAt, parsed.topic,
    JSON.stringify(parsed.tags), JSON.stringify(parsed.persons), status, parseSource, Date.now(), id,
    expected.revisionAt, expected.rawText,
  );
  applied = result.changes > 0;
  if (applied) await syncFtsWithDatabase(txn, id);
  });
  return applied;
}

/** 理解状态标记（LLM 失败但规则结果已回填 → failed，联网后可补理解） */
export async function setParseStatus(id: string, status: 'pending' | 'failed' | 'ok'): Promise<void> {
  const d = await getDb();
  await d.runAsync("UPDATE entries SET parse_status=?, revision_at=MAX(revision_at+1, ?) WHERE id=? AND parse_status!='manual'", status, Date.now(), id);
}

/** 理解失败、待补理解的条目（启动时重试用） */
export async function listParseFailed(limit = 50): Promise<Entry[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries WHERE parse_status IN ('failed', 'pending') ORDER BY updated_at DESC LIMIT ?`, limit,
  );
  return rows.map(rowToEntry);
}

/** 手动纠正（用户一键改）——记录纠正快照供画像学习。
 *  rawText 自 2026-09-01 起允许用户编辑（覆盖 PRD 早期「原文永存」决策，用户拍板）；
 *  未传的字段保持原值——topic 不传即不变，聚合归属不受编辑影响。 */
export async function applyCorrection(
  id: string,
  patch: { kind?: EntryKind; summary?: string; rawText?: string; dueAt?: number | null; topic?: string | null; tags?: string[] },
): Promise<Entry | null> {
  const d = await getDb();
  let updated: Entry | null = null;
  await d.withExclusiveTransactionAsync(async (txn) => {
  const row = await txn.getFirstAsync<any>('SELECT * FROM entries WHERE id=?', id);
  if (!row) return;
  const prev = rowToEntry(row);
  const snapshot = JSON.stringify({
    kind: prev.kind, summary: prev.summary, rawText: prev.rawText,
    dueAt: prev.dueAt, topic: prev.topic, tags: prev.tags,
  });
  const changedAt = Date.now();
  const derived = deriveEditedEntry(prev, patch.summary ?? prev.summary, patch.rawText ?? prev.rawText, changedAt);
  await txn.runAsync(
    `UPDATE entries SET kind=?, summary=?, raw_text=?, due_at=?, remind_at=?, topic=?, tags=?,
       parse_status='manual', corrected_from=?, updated_at=?, revision_at=MAX(revision_at+1, ?)
     WHERE id=?`,
    patch.kind ?? (patch.dueAt != null ? 'task' : derived.kind ?? prev.kind),
    derived.summary,
    patch.rawText ?? prev.rawText,
    patch.dueAt !== undefined ? patch.dueAt : prev.dueAt,
    patch.dueAt !== undefined ? patch.dueAt : prev.dueAt,
    patch.topic !== undefined ? patch.topic : prev.topic,
    JSON.stringify(patch.tags ?? prev.tags),
    snapshot, changedAt, changedAt, id,
  );
  await syncFtsWithDatabase(txn, id);
  await txn.runAsync(`INSERT INTO notification_sync_queue (entry_id, queued_at) VALUES (?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET queued_at=excluded.queued_at`, id, changedAt);
  updated = rowToEntry(await txn.getFirstAsync<any>('SELECT * FROM entries WHERE id=?', id));
  });
  return updated;
}

export async function setDone(id: string, done: boolean): Promise<void> {
  const d = await getDb();
  const changedAt = Date.now();
  await d.runAsync(
    'UPDATE entries SET done=?, done_at=?, revision_at=MAX(revision_at+1, ?) WHERE id=?',
    done ? 1 : 0, done ? changedAt : null, changedAt, id,
  );
}

export async function deleteEntry(id: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM entries WHERE id=?', id);
  await d.runAsync('DELETE FROM entries_fts WHERE entry_id=?', id);
  await d.runAsync('DELETE FROM notification_sync_queue WHERE entry_id=?', id);
}

export async function listEntries(filter?: EntryFilter, limit = 500): Promise<Entry[]> {
  const d = await getDb();
  let sql = 'SELECT * FROM entries';
  const conds: string[] = [];
  const args: any[] = [];

  if (filter?.query?.trim()) {
    // 用 FTS 找 entry_id，再回表拿完整数据
    // 查询词包成短语并转义内部引号，避免 " * ^ - 等 fts5 语法字符触发 SQLite 错误
    const phrase = '"' + filter.query.trim().replace(/"/g, '""') + '"';
    const fts = await d.getAllAsync<any>(
      `SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?`,
      phrase, limit,
    );
    if (fts.length === 0) return [];
    const ids = fts.map((r: any) => r.entry_id);
    const placeholders = ids.map(() => '?').join(',');
    conds.push(`id IN (${placeholders})`);
    args.push(...ids);
  }

  if (filter?.kind && filter.kind !== 'all') {
    conds.push('kind = ?');
    args.push(filter.kind);
  }
  if (filter && !filter.showDone) {
    conds.push('done = 0');
  }

  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  args.push(limit);

  const rows = await d.getAllAsync<any>(sql, ...args);
  return rows.map(rowToEntry);
}

/** 带词高亮的关键词过滤（离线兜底，用于 FTS 未命中时） */
export async function listByKeyword(query: string, limit = 500): Promise<Entry[]> {
  const d = await getDb();
  const like = `%${query.trim()}%`;
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries
     WHERE raw_text LIKE ? OR summary LIKE ? OR tags LIKE ?
     ORDER BY updated_at DESC LIMIT ?`,
    like, like, like, limit,
  );
  return rows.map(rowToEntry);
}

/** 今日到期待办（供「今天」页） */
export async function listTodayTasks(): Promise<Entry[]> {
  const d = await getDb();
  const startOfDay = startOfToday();
  const endOfDay = startOfDay + 24 * 3600 * 1000;
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries
     WHERE kind='task' AND done=0 AND due_at IS NOT NULL AND due_at BETWEEN ? AND ?
     ORDER BY due_at ASC`,
    startOfDay, endOfDay,
  );
  return rows.map(rowToEntry);
}

/** 未过期但尚未完成且无提醒的待办（供拖延检测） */
export async function listOverdueTasks(): Promise<Entry[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries
     WHERE kind='task' AND done=0 AND due_at IS NOT NULL AND due_at < ?
     ORDER BY due_at ASC`,
    Date.now(),
  );
  return rows.map(rowToEntry);
}

/** 全部未完成待办（含无时间的） */
export async function listOpenTasks(): Promise<Entry[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries WHERE kind='task' AND done=0 ORDER BY due_at IS NULL, due_at ASC`,
  );
  return rows.map(rowToEntry);
}

/** 本周待办数据：今日起 7 天窗口内未完成 + 今天已完成（划线展示，次日消失）。
 *  逾期未完成的不再进本周待办（用户决策 2026-09-01）；仍可在搜索/备忘录中找到。 */
export async function listWeekTasks(): Promise<Entry[]> {
  const d = await getDb();
  const startOfDay = startOfToday();
  const windowEnd = startOfDay + 7 * 24 * 3600 * 1000;
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries
     WHERE kind='task' AND due_at IS NOT NULL AND (
       (done = 0 AND due_at >= ? AND due_at < ?)
       OR (done = 1 AND done_at >= ?)
     )
     ORDER BY due_at ASC`,
    startOfDay, windowEnd, startOfDay,
  );
  return rows.map(rowToEntry);
}

/** 长期待办：7 天窗口之后的未完成待办，升序 */
export async function listLongTermTasks(): Promise<Entry[]> {
  const d = await getDb();
  const windowEnd = startOfToday() + 7 * 24 * 3600 * 1000;
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries
     WHERE kind='task' AND done=0 AND due_at IS NOT NULL AND due_at >= ?
     ORDER BY due_at ASC`,
    windowEnd,
  );
  return rows.map(rowToEntry);
}

/** 总记录数（我的页统计行） */
export async function countEntries(): Promise<number> {
  const d = await getDb();
  const r = await d.getFirstAsync<any>('SELECT COUNT(*) AS n FROM entries');
  return r?.n ?? 0;
}

/** 最早一条记录的时间（我的页「已陪伴 N 天」起算点） */
export async function firstEntryAt(): Promise<number | null> {
  const d = await getDb();
  const r = await d.getFirstAsync<any>('SELECT MIN(created_at) AS first FROM entries');
  return r?.first ?? null;
}

/** 近 N 天活跃主题（供理解引擎判断"新话题还是已有主题更新"） */
export async function listActiveTopics(
  days = 180,
  limit = 100,
): Promise<{ topic: string; count: number; latestText: string }[]> {
  const d = await getDb();
  const since = Date.now() - days * 24 * 3600 * 1000;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = await d.getAllAsync<any>(
    `SELECT e.topic, COUNT(*) AS cnt, MAX(e.updated_at) AS latest,
       (SELECT e2.raw_text FROM entries e2 WHERE e2.topic = e.topic
        ORDER BY e2.updated_at DESC LIMIT 1) AS latest_text
     FROM entries e WHERE e.topic IS NOT NULL AND e.updated_at >= ?
     GROUP BY e.topic
     ORDER BY latest DESC LIMIT ?`,
    since, safeLimit,
  );
  return rows.map((r: any) => ({ topic: r.topic, count: r.cnt, latestText: r.latest_text ?? '' }));
}

/** 主题分组视图 */
export async function listTopicGroups(): Promise<TopicGroup[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>(`
    WITH counted AS (
      SELECT topic, COUNT(*) AS entry_count FROM entries
      WHERE topic IS NOT NULL AND TRIM(topic) != '' GROUP BY topic
    )
    SELECT e.*, counted.entry_count, p.pinned_at
    FROM counted JOIN entries e ON e.id = (
      SELECT latest.id FROM entries latest WHERE latest.topic = counted.topic
      ORDER BY latest.updated_at DESC, latest.created_at DESC, latest.id DESC LIMIT 1
    )
    LEFT JOIN topic_preferences p ON p.topic = counted.topic
  `);
  return sortTopicGroups(rows.map((row) => {
    const latest = rowToEntry(row);
    return {
      topic: row.topic, count: row.entry_count, latest,
      updatedAt: latest.updatedAt, pinnedAt: row.pinned_at ?? null,
    };
  }));
}

/** 非空主题的所有条目 */
export async function listByTopic(topic: string): Promise<Entry[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<any>(
    `SELECT * FROM entries WHERE topic=? ORDER BY updated_at DESC`, topic,
  );
  return rows.map(rowToEntry);
}

/** 主题重命名/合并 */
export async function renameTopic(from: string, to: string): Promise<void> {
  const d = await getDb();
  const target = to.trim();
  if (!target || target === from) return;

  await d.withExclusiveTransactionAsync(async (txn) => {
    const pins = await txn.getAllAsync<{ pinned_at: number | null }>(
      'SELECT pinned_at FROM topic_preferences WHERE topic IN (?, ?)',
      from,
      target,
    );
    const pinnedAt = pins.reduce<number | null>(
      (latest, row) => row.pinned_at !== null && (latest === null || row.pinned_at > latest)
        ? row.pinned_at
        : latest,
      null,
    );

    await txn.runAsync('UPDATE entries SET topic=?, revision_at=MAX(revision_at+1, ?) WHERE topic=?', target, Date.now(), from);
    await txn.runAsync('DELETE FROM topic_preferences WHERE topic IN (?, ?)', from, target);
    if (pinnedAt !== null) {
      await txn.runAsync(
        'INSERT INTO topic_preferences (topic, pinned_at) VALUES (?, ?)',
        target,
        pinnedAt,
      );
    }
  });
}

/** 置顶或取消置顶一个聚合主题。重复操作保持幂等。 */
export async function setTopicPinned(topic: string, pinned: boolean): Promise<void> {
  const d = await getDb();
  if (pinned) {
    await d.runAsync(
      `INSERT INTO topic_preferences (topic, pinned_at) VALUES (?, ?)
       ON CONFLICT(topic) DO UPDATE SET pinned_at=excluded.pinned_at`,
      topic,
      Date.now(),
    );
  } else {
    await d.runAsync('DELETE FROM topic_preferences WHERE topic=?', topic);
  }
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 同步单条 entry 到 FTS（trigram 自动切词，中文无需分词器） */
async function syncFts(id: string): Promise<void> {
  const d = await getDb();
  await syncFtsWithDatabase(d, id);
}

async function syncFtsWithDatabase(d: SQLite.SQLiteDatabase, id: string): Promise<void> {
  const row = await d.getFirstAsync<any>('SELECT * FROM entries WHERE id=?', id);
  const e = row ? rowToEntry(row) : null;
  if (!e) return;
  const precision = inferTimePrecision(e.rawText, e.dueAt) === 'dateTime'
    || (e.parseStatus === 'manual' && inferTimePrecision(e.summary, e.dueAt) === 'dateTime') ? 'dateTime' : 'date';
  await d.runAsync('UPDATE entries SET time_precision=? WHERE id=?', precision, id);
  // 先删旧
  await d.runAsync('DELETE FROM entries_fts WHERE entry_id=?', id);
  await d.runAsync(
    `INSERT INTO entries_fts (entry_id, summary, raw_text, tags) VALUES (?, ?, ?, ?)`,
    id, e.summary, e.rawText, e.tags.join(' '),
  );
}

/** 全量重建 FTS（理解回填/恢复后调用） */
export async function rebuildFts(): Promise<void> {
  await rebuildFtsWithDatabase(await getDb());
}

/* ---------------- Profile & Settings ---------------- */

export async function getProfile(): Promise<Profile> {
  const d = await getDb();
  const r = await d.getFirstAsync<any>('SELECT * FROM profile WHERE id=1');
  return rowToProfile(r);
}

export async function saveProfile(p: Profile): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `UPDATE profile SET name=?, goals=?, avoid=?, notify_morning=?, notify_evening=? WHERE id=1`,
    p.name, JSON.stringify(p.goals), JSON.stringify(p.avoid),
    p.notifyMorning ? 1 : 0, p.notifyEvening ? 1 : 0,
  );
}

export async function getSettings(): Promise<Settings> {
  const d = await getDb();
  const r = await d.getFirstAsync<any>('SELECT * FROM settings WHERE id=1');
  if (!r) return DEFAULT_SETTINGS;
  return {
    llmEnabled: !!r.llm_enabled,
    llmBaseUrl: r.llm_base_url,
    llmKey: r.llm_key,
    llmModel: r.llm_model,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `UPDATE settings SET llm_enabled=?, llm_base_url=?, llm_key=?, llm_model=? WHERE id=1`,
    s.llmEnabled ? 1 : 0, s.llmBaseUrl, s.llmKey, s.llmModel,
  );
}

/* ---------------- Import ---------------- */

export async function previewBackupImport(payload: BackupPayload): Promise<ImportPreview> {
  const d = await getDb();
  const [rows, profileRow] = await Promise.all([
    d.getAllAsync<any>('SELECT * FROM entries'),
    d.getFirstAsync<any>('SELECT * FROM profile WHERE id=1'),
  ]);
  const localEntries = rows.map(rowToEntry);
  const decisions = buildImportDecisions(payload.entries, localEntries);
  return summarizeImport(decisions, rowToProfile(profileRow), payload);
}

/**
 * 将已通过格式校验的备份合并到当前库。
 * 预览后仍会在独占事务中重新计算决策，避免确认期间本地数据变化导致误覆盖。
 */
export async function importBackup(envelope: BackupEnvelope): Promise<ImportResult> {
  const d = await getDb();
  let preview: ImportPreview = {
    added: 0,
    updated: 0,
    ignored: 0,
    conflicts: 0,
    profileWillImport: false,
  };
  let affectedIds: string[] = [];
  let affectedEntries: Entry[] = [];
  let profileImported = false;

  await d.withExclusiveTransactionAsync(async (txn) => {
    const [rows, profileRow] = await Promise.all([
      txn.getAllAsync<any>('SELECT * FROM entries'),
      txn.getFirstAsync<any>('SELECT * FROM profile WHERE id=1'),
    ]);
    const localEntries = rows.map(rowToEntry);
    const localProfile = rowToProfile(profileRow);
    const decisions = buildImportDecisions(envelope.payload.entries, localEntries);
    preview = summarizeImport(decisions, localProfile, envelope.payload);
    affectedIds = [];
    affectedEntries = [];
    const importedAt = Date.now();

    for (const decision of decisions) {
      if (decision.hasConflict && decision.local) {
        const winner = decision.action === 'update' ? 'incoming' : 'local';
        await txn.runAsync(
          `INSERT OR IGNORE INTO import_conflicts (
             id, entry_id, local_snapshot, incoming_snapshot, winner, reason,
             imported_at, source_exported_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          `${envelope.exportedAt}:${decision.incoming.id}:${decision.local.revisionAt}:${decision.incoming.revisionAt}:${decision.reason}`,
          decision.incoming.id,
          JSON.stringify(decision.local),
          JSON.stringify(decision.incoming),
          winner,
          decision.reason,
          importedAt,
          envelope.exportedAt,
        );
      }

      if (decision.action === 'add') {
        await insertImportedEntry(txn, decision.incoming);
        affectedIds.push(decision.incoming.id);
        affectedEntries.push(decision.incoming);
      } else if (decision.action === 'update') {
        await updateImportedEntry(txn, decision.incoming);
        affectedIds.push(decision.incoming.id);
        affectedEntries.push(decision.incoming);
      }
    }

    if (isDefaultProfile(localProfile) && !isDefaultProfile(envelope.payload.profile)) {
      const profile = envelope.payload.profile;
      await txn.runAsync(
        `UPDATE profile SET name=?, goals=?, avoid=?, notify_morning=?, notify_evening=? WHERE id=1`,
        profile.name,
        JSON.stringify(profile.goals),
        JSON.stringify(profile.avoid),
        profile.notifyMorning ? 1 : 0,
        profile.notifyEvening ? 1 : 0,
      );
      profileImported = true;
    }

    for (const preference of envelope.payload.topicPreferences) {
      await txn.runAsync(
        `INSERT INTO topic_preferences (topic, pinned_at) VALUES (?, ?)
         ON CONFLICT(topic) DO UPDATE SET pinned_at=MAX(topic_preferences.pinned_at, excluded.pinned_at)`,
        preference.topic,
        preference.pinnedAt,
      );
    }

    for (const entryId of affectedIds) {
      await txn.runAsync(
        `INSERT INTO notification_sync_queue (entry_id, queued_at) VALUES (?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET queued_at=excluded.queued_at`,
        entryId,
        importedAt,
      );
    }

    if (affectedIds.length > 0) await rebuildFtsWithDatabase(txn);
  });

  return { ...preview, affectedEntries, profileImported };
}

export async function listPendingNotificationSyncEntries(): Promise<Entry[]> {
  const rows = await (await getDb()).getAllAsync<any>(
    `SELECT entries.* FROM notification_sync_queue
     JOIN entries ON entries.id = notification_sync_queue.entry_id
     ORDER BY notification_sync_queue.queued_at ASC`,
  );
  return rows.map(rowToEntry);
}

export async function clearPendingNotificationSync(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const d = await getDb();
  await d.withExclusiveTransactionAsync(async (txn) => {
    for (const entryId of entryIds) {
      await txn.runAsync('DELETE FROM notification_sync_queue WHERE entry_id=?', entryId);
    }
  });
}

/* ---------------- Export ---------------- */

export async function exportMarkdown(): Promise<string> {
  const d = await getDb();
  const [rows, profile, preferenceRows] = await Promise.all([
    d.getAllAsync<any>('SELECT * FROM entries ORDER BY created_at ASC'),
    getProfile(),
    d.getAllAsync<{ topic: string; pinned_at: number | null }>(
      'SELECT topic, pinned_at FROM topic_preferences WHERE pinned_at IS NOT NULL ORDER BY topic ASC',
    ),
  ]);
  const entries = rows.map(rowToEntry);
  let md = '# 我的个人助手记录\n\n';
  for (const e of entries) {
    const ts = new Date(e.createdAt).toLocaleString('zh-CN');
    const kindLabel = { task: '待办', idea: '想法', info: '信息' }[e.kind] ?? e.kind;
    const doneLabel = e.done ? ' ✅完成' : '';
    md += `## ${kindLabel}${doneLabel} · ${ts}\n\n`;
    md += `> ${e.rawText}\n\n`;
    if (e.summary !== e.rawText) md += `**理解**：${e.summary}\n\n`;
    if (e.topic) md += `主题：${e.topic}\n\n`;
    if (e.tags.length) md += `标签：${e.tags.join('、')}\n\n`;
    if (e.dueAt) md += `时间：${new Date(e.dueAt).toLocaleString('zh-CN')}\n\n`;
    md += '---\n\n';
  }
  const topicPreferences: TopicPreference[] = preferenceRows.map((row) => ({
    topic: row.topic,
    pinnedAt: row.pinned_at!,
  }));
  const payload: BackupPayload = { entries, profile, topicPreferences };
  return buildImportableMarkdown(md, payload);
}
