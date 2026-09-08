import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { getEntry, queryAll, queryFirst, runSql } from '../db';
import { calendarProjection } from './calendar-projection';
import type { ExpoCalendarEvent } from 'expo-calendar';

interface Config { enabled: number; calendar_id: string | null; owner_token: string; error: string | null }
interface Link { entry_id: string; event_id: string | null; attempt_due: number | null; last_due: number | null }
export async function calendarStatus() {
  const config = (await queryFirst<Config>('SELECT * FROM calendar_config WHERE id=1'))!;
  const pending = await queryFirst<{ count: number }>('SELECT COUNT(*) AS count FROM calendar_jobs');
  return { ...config, pending: config.enabled ? pending?.count ?? 0 : 0 };
}

async function api() {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('CalendarNext')) {
    throw new Error('请安装支持日历同步的新版私人助手。');
  }
  return import('expo-calendar');
}

// One chain also serializes enable/disable against in-flight native writes.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(work, work);
  chain = result.catch(() => {});
  return result;
}

export async function calendarAccounts() {
  const cal = await api();
  if (!(await cal.requestCalendarPermissions(false)).granted) throw new Error('请在系统设置中允许日历完整访问，然后重试。');
  const calendars = await cal.getCalendars(cal.EntityTypes.EVENT);
  const sources = cal.getSourcesSync();
  return sources.filter(source => calendars.some(c => c.sourceId === source.id && c.allowsModifications))
    .map(source => ({ id: source.id, name: source.name }));
}

export function setCalendarEnabled(enabled: boolean, sourceId?: string): Promise<void> {
  return serial(async () => {
    if (!enabled) {
      await runSql('UPDATE calendar_config SET enabled=0,error=NULL WHERE id=1');
      return;
    }
    const cal = await api();
    if (!(await cal.requestCalendarPermissions(false)).granted) throw new Error('请在系统设置中允许日历完整访问。');
    const config = await calendarStatus();
    if (config.calendar_id) {
      const existing = (await cal.getCalendars(cal.EntityTypes.EVENT)).find(c => c.id === config.calendar_id);
      if (!existing?.allowsModifications) throw new Error('原同步日历已删除或不可写。请恢复原日历后重试，避免重复创建日程。');
    } else {
      if (!sourceId) throw new Error('请选择可写入的日历账户。');
      const ownedName = `私人助手 · ${config.owner_token.slice(0, 8)}`;
      // Recover a calendar created just before a database failure; never adopt by generic title.
      const calendars = await cal.getCalendars(cal.EntityTypes.EVENT);
      const target = calendars.find(c => c.title === ownedName && c.sourceId === sourceId)
        ?? await cal.createCalendar({ title: ownedName, color: '#DE7941', sourceId, entityType: cal.EntityTypes.EVENT });
      await runSql('UPDATE calendar_config SET calendar_id=? WHERE id=1', target.id);
    }
    await runSql('UPDATE calendar_config SET enabled=1,error=NULL WHERE id=1');
    await runSql(`INSERT OR IGNORE INTO calendar_jobs(entry_id) SELECT id FROM entries
      WHERE kind='task' AND done=0 AND due_at>=?`, today());
    await enqueueLinks();
  });
}

function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function isMissingEvent(error: unknown): boolean {
  const value = error as { code?: string; message?: string };
  return value.code === 'ERR_EVENT_NOT_FOUND'
    || /(?:event|日程).*(?:not found|不存在|找不到)|(?:not found|不存在|找不到).*(?:event|日程)/i.test(value.message ?? '');
}
async function enqueueLinks() {
  await runSql('INSERT OR IGNORE INTO calendar_jobs(entry_id) SELECT entry_id FROM calendar_links');
}

let pending: Promise<void> | null = null;
let retryAfter = 0;
export function syncCalendar(reconcile = false): Promise<void> {
  if (pending) return pending;
  if (!reconcile && Date.now() < retryAfter) return Promise.resolve();
  pending = serial(async () => {
    const config = await calendarStatus();
    if (!config.enabled) return;
    if (!reconcile && !config.pending) return;
    try {
      const cal = await api();
      if (!(await cal.getCalendarPermissions(false)).granted) throw new Error('日历权限已关闭，请到系统设置恢复完整访问。');
      const calendar = (await cal.getCalendars(cal.EntityTypes.EVENT)).find(c => c.id === config.calendar_id);
      if (!calendar?.allowsModifications) throw new Error('同步日历已删除或不可写，请恢复原日历后重试。');
      if (reconcile) {
        await enqueueLinks();
        await runSql('UPDATE calendar_jobs SET retry_at=0');
      }
      const jobs = await queryAll<{ entry_id: string; generation: number }>('SELECT * FROM calendar_jobs WHERE retry_at<=? ORDER BY retry_at LIMIT 50', Date.now());
      let failed = false;
      for (const job of jobs) {
        try {
          const entry = await getEntry(job.entry_id);
          const link = await queryFirst<Link>('SELECT * FROM calendar_links WHERE entry_id=?', job.entry_id);
          const data = entry ? calendarProjection(entry, config.owner_token) : null;
          // Historical tasks are not exported on first enable. Existing mappings always reconcile.
          const desired = data && (link || (!entry!.done && entry!.dueAt! >= today())) ? data : null;
          const marker = `assistantapp://entry/${encodeURIComponent(job.entry_id)}?calendarOwner=${config.owner_token}`;
          let event: ExpoCalendarEvent | undefined;
          if (link?.event_id) {
            try { event = await cal.ExpoCalendarEvent.get(link.event_id); }
            catch (error) {
              if (!isMissingEvent(error)) throw error;
            }
            if (event && (event.calendarId !== calendar.id || event.url !== marker)) {
              throw new Error('关联日程已被移动或来源标记改变，请恢复后重试。');
            }
          }
          if (!event && link) {
            // A successful create/update may precede a crash: search both durable old and intended dates.
            for (const at of new Set([link.last_due, link.attempt_due, entry?.dueAt])) {
              if (at == null) continue;
              const start = new Date(at); start.setDate(start.getDate() - 2);
              const end = new Date(at); end.setDate(end.getDate() + 2);
              const matches = (await calendar.listEvents(start, end)).filter(e => e.url === marker);
              if (matches.length > 1) throw new Error('检测到重复关联日程，请处理后重试。');
              if (matches[0]) { event = matches[0]; break; }
            }
          }
          if (desired) {
            await runSql(`INSERT INTO calendar_links(entry_id,attempt_due) VALUES(?,?)
              ON CONFLICT(entry_id) DO UPDATE SET attempt_due=excluded.attempt_due`, job.entry_id, entry!.dueAt);
            if (event) await event.update(desired);
            else event = await calendar.createEvent(desired);
            await runSql('UPDATE calendar_links SET event_id=?,last_due=?,attempt_due=NULL WHERE entry_id=?',
              event.id, entry!.dueAt, job.entry_id);
          } else {
            if (event) await event.delete();
            await runSql('DELETE FROM calendar_links WHERE entry_id=?', job.entry_id);
          }
          // New edits increment generation. Never acknowledge a newer task with an old response.
          await runSql('DELETE FROM calendar_jobs WHERE entry_id=? AND generation=?', job.entry_id, job.generation);
        } catch (error) {
          failed = true;
          await runSql('UPDATE calendar_jobs SET retry_at=? WHERE entry_id=? AND generation=?', Date.now() + 60000, job.entry_id, job.generation);
          await runSql('UPDATE calendar_config SET error=? WHERE id=1', error instanceof Error ? error.message : '日历写入失败，请重试');
        }
      }
      retryAfter = 0;
      if (!failed && !(await calendarStatus()).pending) await runSql('UPDATE calendar_config SET error=NULL WHERE id=1');
    } catch (error) {
      retryAfter = Date.now() + 60000;
      await runSql('UPDATE calendar_config SET error=? WHERE id=1', error instanceof Error ? error.message : '日历暂不可用');
    }
  }).finally(() => { pending = null; });
  return pending;
}
