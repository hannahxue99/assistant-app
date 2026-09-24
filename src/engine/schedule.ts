/**
 * 待办分窗 — 纯函数，可离线单测（对应 DESIGN「本周待办 / 长期待办」规则）
 *
 * 规则：
 * - 本周待办窗口 = 今天起向后 7 天；数据层已不带入逾期项（2026-09-01 改版），
 *   传入时仍容错归入今天组排最前并标「已逾期」
 * - 今天完成的待办保留在今日组（划线展示），次日自然消失（由查询层不带入）
 * - 无待办的日期不产出分组（整行不展示）
 */
import type { Entry } from '../types';

export interface DayGroup {
  dayKey: string;        // 2026-08-31（本地日）
  dateLabel: string;     // 8/31
  weekdayLabel: string;  // 周一
  isToday: boolean;
  entries: Entry[];      // 逾期在前，其余按 dueAt 升序，完成的沉底
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const TODO_WINDOW_DAYS = 7;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 首页两个待办页签共用的唯一分窗规则；无日期和已过期项不在首页定位。 */
export function todoViewForDueAt(dueAt: number | null, now = Date.now()): 'week' | 'all' | null {
  if (dueAt === null) return null;
  const windowStart = startOfDay(now);
  if (dueAt < windowStart) return null;
  return dueAt < windowStart + TODO_WINDOW_DAYS * 24 * 3600 * 1000 ? 'week' : 'all';
}

export function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function weekdayLabel(ts: number): string {
  return WEEKDAYS[new Date(ts).getDay()];
}

export function mdLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 行内时间位：有时刻 → HH:mm；仅日期 → 全天 */
export function timeLabel(dueAt: number | null): string {
  if (!dueAt) return '全天';
  const d = new Date(dueAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 用户原声时间戳（相对日期 + 时刻）：
 *  今天/昨天/前天 → 「今天 14:23:05」；今年其他日 → 「09-01 14:23:05」；跨年 → 「2025-09-01 14:23:05」 */
export function logTimestamp(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const hms = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const dayOf = (x: Date) => {
    const q = new Date(x);
    q.setHours(0, 0, 0, 0);
    return q.getTime();
  };
  const days = Math.round((dayOf(new Date(now)) - dayOf(d)) / 86400000);
  if (days === 0) return `今天 ${hms}`;
  if (days === 1) return `昨天 ${hms}`;
  if (days === 2) return `前天 ${hms}`;
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return d.getFullYear() === new Date(now).getFullYear() ? `${md} ${hms}` : `${d.getFullYear()}-${md} ${hms}`;
}

/** 详情页完整时间戳：YYYY-MM-DD HH:mm:ss */
export function fullTimestamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function isOverdue(e: Entry, now = Date.now()): boolean {
  return e.kind === 'task' && !e.done && !!e.dueAt && e.dueAt < startOfDay(now);
}

/**
 * 把「逾期 + 7 天窗口内 + 今天完成」的待办按日分组。
 * 逾期的归入今天组并排在最前；空日期不产组。
 */
export function groupWeekTasks(entries: Entry[], now = Date.now()): DayGroup[] {
  const todayKey = dayKeyOf(now);
  const map = new Map<string, Entry[]>();

  for (const e of entries) {
    const overdue = isOverdue(e, now);
    const key = overdue || !e.dueAt ? todayKey : dayKeyOf(e.dueAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }

  const groups: DayGroup[] = [];
  for (const [key, list] of map) {
    const ts = new Date(key + 'T00:00:00').getTime();
    list.sort((a, b) => {
      const oa = isOverdue(a, now) ? 0 : 1;
      const ob = isOverdue(b, now) ? 0 : 1;
      if (oa !== ob) return oa - ob;                    // 逾期最前
      if (!!a.done !== !!b.done) return a.done - b.done; // 完成沉底
      return (a.dueAt ?? 0) - (b.dueAt ?? 0);
    });
    groups.push({
      dayKey: key,
      dateLabel: mdLabel(ts),
      weekdayLabel: weekdayLabel(ts),
      isToday: key === todayKey,
      entries: list,
    });
  }
  groups.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  return groups;
}

/** 长期待办行标签：9/15 周二（2026-09-01 与本周待办统一，去小时） */
export function longTermLabel(dueAt: number): string {
  return `${mdLabel(dueAt)} ${weekdayLabel(dueAt)}`;
}

/** 纯日期标签：M/D 周X（无"今天/明天"相对前缀，供备忘录/聚合卡等非待办语境使用） */
export function dateLabel(dueAt: number): string {
  return `${mdLabel(dueAt)} ${weekdayLabel(dueAt)}`;
}

/** 本周待办行标签（2026-09-25 需求：日期在前，今天/明天替代星期）：
 *  今天 → 「9/1 今天」；明天 → 「9/2 明天」；后天起 → 「9/3 周三」 */
export function weekTaskLabel(dueAt: number | null, now = Date.now()): string {
  if (!dueAt) return '全天';
  const d = new Date(dueAt);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const wd = weekdayLabel(dueAt);
  const dayOf = (x: Date) => {
    const q = new Date(x);
    q.setHours(0, 0, 0, 0);
    return q.getTime();
  };
  const days = Math.round((dayOf(d) - dayOf(new Date(now))) / 86400000);
  if (days === 0) return `${md} 今天`;
  if (days === 1) return `${md} 明天`;
  return `${md} ${wd}`;
}
