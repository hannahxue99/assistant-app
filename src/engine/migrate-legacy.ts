/**
 * 一次性迁移：老 App（com.anonymous.assistantapp）→ 新 App（com.huanxue.assistantapp）
 * 数据来源：老 App「导出数据」的 Markdown（2026-09-01，5 条）。
 * 迁移完成后在 settings 表打 migration.legacyV1=done 标记，永不重复执行。
 */
import { insertEntry, queryFirst, runSql } from '../db';
import type { EntryKind } from '../types';

interface LegacyEntry {
  kind: string;
  createdAt: string;
  rawText: string;
  summary: string;
  topic: string | null;
  tags: string[];
  dueAt: string | null;
  done: boolean;
}

const LEGACY_ENTRIES: LegacyEntry[] = [
  { kind: 'task', createdAt: '2026/9/1 11:05:29', rawText: '本周日优优过生日，约吃饭', summary: '本周日为优优庆生，约吃饭', topic: null, tags: ['生日', '聚餐'], dueAt: null, done: false },
  { kind: 'task', createdAt: '2026/9/1 11:11:04', rawText: '本周六去中日友好医院看牙', summary: '本周六去中日友好医院看牙', topic: null, tags: ['看牙', '中日友好医院'], dueAt: null, done: false },
  { kind: 'task', createdAt: '2026/9/1 11:17:44', rawText: '下周六去医院，记得预约哈', summary: '预约下周六去医院', topic: null, tags: ['医院预约', '就医'], dueAt: '2026/9/12 09:00:00', done: false },
  { kind: 'task', createdAt: '2026/9/1 11:21:32', rawText: '我8月26号来例假了啊哈哈', summary: '8月26日来例假了', topic: '生理周期记录', tags: ['生理期', '健康记录'], dueAt: '2026/8/26 09:00:00', done: false },
  { kind: 'task', createdAt: '2026/9/1 11:22:03', rawText: '7月23号来例假了', summary: '7月23号来例假了', topic: '生理周期记录', tags: ['例假', '生理周期'], dueAt: '2026/7/23 09:00:00', done: false },
];

function parseCnDate(s: string): number {
  // "2026/9/1 11:05:29"（本地时区）
  const [d, t] = s.split(' ');
  const [y, mo, da] = d.split('/').map(Number);
  const [h, mi, se] = (t ?? '0:0:0').split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, se).getTime();
}

/** 启动时调用；已迁移或库非空则跳过。返回迁移条数。 */
export async function migrateLegacyOnce(): Promise<number> {
  // 已迁移 → 跳过（migration_flags 表不存在时查询抛错，视为未迁移）
  const flag = await queryFirst<any>(
    `SELECT done_at FROM migration_flags WHERE key='legacyV1'`
  ).catch(() => null);
  if (flag) return 0;

  const existing = await queryFirst<any>('SELECT COUNT(*) AS n FROM entries');
  if ((existing?.n ?? 0) > 0) return 0; // 已有数据，不迁移（防误覆盖）

  let count = 0;
  for (const e of LEGACY_ENTRIES) {
    await insertEntry(
      { rawText: e.rawText, source: 'text', createdAt: parseCnDate(e.createdAt) },
      {
        kind: e.kind as EntryKind,
        summary: e.summary,
        dueAt: e.dueAt ? parseCnDate(e.dueAt) : null,
        tags: e.tags,
        topic: e.topic,
        persons: [],
      },
    );
    count++;
  }
  // 打标记：独立小表，只存一行，不污染 entries
  await runSql(`CREATE TABLE IF NOT EXISTS migration_flags (key TEXT PRIMARY KEY, done_at INTEGER NOT NULL)`);
  await runSql(`INSERT OR REPLACE INTO migration_flags (key, done_at) VALUES ('legacyV1', ?)`, Date.now());
  console.log(`[migrate] legacy ${count} entries imported`);
  return count;
}
