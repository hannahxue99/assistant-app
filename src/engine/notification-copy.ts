/**
 * 晨问/夜间提醒的待办选择与文案生成。
 * 纯函数，不依赖 React Native / expo-notifications，便于电脑端回归测试。
 */
import type { Entry } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 5;

export type ReminderKind = 'morning' | 'evening';

export interface ReminderCopy {
  title: string;
  body: string;
  entries: Entry[];
  source: 'today' | 'week' | 'nearest';
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function openTimedTasks(entries: Entry[]): Entry[] {
  return entries
    .filter((e) => e.kind === 'task' && !e.done && e.dueAt !== null)
    .sort((a, b) => a.dueAt! - b.dueAt!);
}

function renderBody(prefix: string, entries: Entry[]): string {
  const summaries = entries.slice(0, MAX_ITEMS).map((e) => e.summary.trim()).filter(Boolean);
  return `${prefix}：${summaries.join('；')}`;
}

/**
 * 晨问：今天 → 从今天起7天 → 最近5条未来待办。
 * targetTs 是通知触发日的任意时刻。
 */
export function buildMorningCopy(entries: Entry[], targetTs: number): ReminderCopy | null {
  const tasks = openTimedTasks(entries);
  const dayStart = startOfDay(targetTs);
  const tomorrow = dayStart + DAY;
  const weekEnd = dayStart + 7 * DAY;

  const today = tasks.filter((e) => e.dueAt! >= dayStart && e.dueAt! < tomorrow).slice(0, MAX_ITEMS);
  if (today.length) {
    return {
      title: '早安，今天要做',
      body: renderBody('今天待办', today),
      entries: today,
      source: 'today',
    };
  }

  const week = tasks.filter((e) => e.dueAt! >= dayStart && e.dueAt! < weekEnd).slice(0, MAX_ITEMS);
  if (week.length) {
    return {
      title: '早安，本周待办',
      body: renderBody('本周优先', week),
      entries: week,
      source: 'week',
    };
  }

  const nearest = tasks.filter((e) => e.dueAt! >= dayStart).slice(0, MAX_ITEMS);
  if (!nearest.length) return null;
  return {
    title: '早安，接下来要做',
    body: renderBody('最近待办', nearest),
    entries: nearest,
    source: 'nearest',
  };
}

/**
 * 夜间：明天起7天 → 最近5条未来待办。
 * 今天到期的任务不进入夜间“接下来”提醒。
 */
export function buildEveningCopy(entries: Entry[], targetTs: number): ReminderCopy | null {
  const tasks = openTimedTasks(entries);
  const dayStart = startOfDay(targetTs);
  const tomorrow = dayStart + DAY;
  const weekEnd = dayStart + 7 * DAY;

  const restOfWeek = tasks.filter((e) => e.dueAt! >= tomorrow && e.dueAt! < weekEnd).slice(0, MAX_ITEMS);
  if (restOfWeek.length) {
    return {
      title: '今晚看看接下来的安排',
      body: renderBody('本周剩余', restOfWeek),
      entries: restOfWeek,
      source: 'week',
    };
  }

  const nearest = tasks.filter((e) => e.dueAt! >= tomorrow).slice(0, MAX_ITEMS);
  if (!nearest.length) return null;
  return {
    title: '今晚看看后面的安排',
    body: renderBody('最近待办', nearest),
    entries: nearest,
    source: 'nearest',
  };
}
