import type { Entry } from '../types';
import { parseChineseTime } from './time';

export const hasExplicitClock = (text: string) => /(?:\d{1,2}[:：]\d{2}|[一二两三四五六七八九十\d]+[点時])/.test(text);

/** Keep selected calendar date, apply only an explicitly written clock on user save. */
export function editedDueTime(previous: Entry, title: string, body: string, dueAt: number | null) {
  if (dueAt == null) return null;
  const source = title !== previous.summary && hasExplicitClock(title) ? title : body;
  if (!hasExplicitClock(source)) return dueAt;
  const parsed = parseChineseTime(source, dueAt).dueAt;
  if (parsed == null) return dueAt;
  const result = new Date(dueAt), clock = new Date(parsed);
  result.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return +result;
}

/** Require explicit clock text matching the stored due time. Never infer from default 09:00. */
export function inferTimePrecision(body: string, dueAt: number | null): 'date' | 'dateTime' {
  if (dueAt == null || !hasExplicitClock(body)) return 'date';
  const parsed = parseChineseTime(body, dueAt).dueAt;
  if (parsed == null) return 'date';
  const a = new Date(parsed), b = new Date(dueAt);
  return a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes() ? 'dateTime' : 'date';
}

export function calendarProjection(entry: Entry, owner: string) {
  if (entry.kind !== 'task' || entry.dueAt == null) return null;
  const allDay = (entry.timePrecision ?? inferTimePrecision(entry.rawText, entry.dueAt)) !== 'dateTime';
  const startDate = new Date(entry.dueAt);
  if (allDay) startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  // EventKit/Apple Calendar renders an all-day end at next-day 00:00 on both
  // dates in this integration. Keep the event inside the selected civil day.
  if (allDay) endDate.setHours(23, 59, 59, 999);
  else endDate.setHours(endDate.getHours() + 1);
  return {
    title: `${entry.done ? '✓ ' : ''}${entry.summary}`, startDate, endDate, allDay,
    notes: `${entry.rawText}\n\n由私人助手维护${allDay ? '' : '；默认占位1小时'}`,
    url: `assistantapp://entry/${encodeURIComponent(entry.id)}?calendarOwner=${owner}`,
    alarms: [],
  };
}
