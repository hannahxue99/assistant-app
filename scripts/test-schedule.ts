/**
 * 待办分窗回归测试 — 纯逻辑，电脑直跑
 * 用法：npx tsx scripts/test-schedule.ts
 * 基线固定为 2026-08-31（周一）12:00，断言可重复
 */
import {
  groupWeekTasks,
  isOverdue,
  logTimestamp,
  longTermLabel,
  weekTaskLabel,
} from '../src/engine/schedule';
import type { Entry } from '../src/types';

// 固定基线：2026-08-31 周一 12:00 本地时间
const NOW = new Date(2026, 7, 31, 12, 0).getTime();
const DAY = 86400000;

function entry(partial: Partial<Entry> & { id: string }): Entry {
  return {
    rawText: 'x', kind: 'task', summary: partial.id, dueAt: null, remindAt: null,
    topic: null, tags: [], persons: [], parseStatus: 'ok', parseSource: 'rule',
    correctedFrom: null, createdAt: NOW, updatedAt: NOW, done: 0, doneAt: null, source: 'text',
    ...partial,
  };
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const overdueTask = entry({ id: '逾期', dueAt: NOW - 2 * DAY });            // 8/29 到期未完成
const todayTask = entry({ id: '今天', dueAt: new Date(2026, 7, 31, 15, 0).getTime() });
const wedTask = entry({ id: '周三', dueAt: new Date(2026, 8, 2, 10, 0).getTime() });
const day7Task = entry({ id: '第7天', dueAt: new Date(2026, 8, 6, 9, 0).getTime() }); // 9/6 窗口内
const doneToday = entry({ id: '已完成', dueAt: new Date(2026, 7, 31, 9, 0).getTime(), done: 1, doneAt: NOW - 3600000 });

console.log('— groupWeekTasks —');
// 数据层（listWeekTasks）2026-09-01 起不再带入逾期项；此处模拟其输出
const groups = groupWeekTasks([wedTask, doneToday, todayTask, day7Task], NOW);
// 容错：万一有逾期项传进来，仍归今天组排最前（旧语义保留）
const withOverdue = groupWeekTasks([todayTask, overdueTask], NOW);
const todayWithOverdue = withOverdue.find((g) => g.isToday)!;

check('空日期不产组（只有 3 个有内容的日组）', groups.length === 3);
check('第 7 天（9/6）仍在窗口内', groups.some((g) => g.dateLabel === '9/6'));
const todayGroup = groups[0];
check('今天组排第一', todayGroup.isToday && todayGroup.dateLabel === '8/31');
check('逾期（容错）归今天且排最前', todayWithOverdue.entries[0].id === '逾期');
check('已完成沉到日组末尾', todayGroup.entries[todayGroup.entries.length - 1].id === '已完成');

console.log('— isOverdue —');
check('昨天到期未完成 = 逾期', isOverdue(overdueTask, NOW));
check('今天到期未完成 ≠ 逾期', !isOverdue(todayTask, NOW));
check('已完成 ≠ 逾期', !isOverdue(doneToday, NOW));

console.log('— 行标签 —');
check('本周行（今天）显 今天 M/D 周X', weekTaskLabel(todayTask.dueAt, NOW) === '今天 8/31 周一');
check('本周行（明天）显 明天 M/D 周X', weekTaskLabel(NOW + DAY, NOW) === '明天 9/1 周二');
check('本周行（后天）显 M/D 周X', weekTaskLabel(NOW + 2 * DAY, NOW) === '9/2 周三');
check('长期行格式 9/2 周三（无小时）', longTermLabel(wedTask.dueAt!) === '9/2 周三');
check('无时刻显 全天', weekTaskLabel(null) === '全天');

console.log('— 用户原声时间戳（相对日期，2026-09-01 改版）—');
// NOW = 2026-08-31 12:00（周一）
check('今天 + 时刻', logTimestamp(new Date(2026, 7, 31, 9, 5, 9).getTime(), NOW) === '今天 09:05:09');
check('昨天 + 时刻', logTimestamp(new Date(2026, 7, 30, 22, 47, 31).getTime(), NOW) === '昨天 22:47:31');
check('前天 + 时刻', logTimestamp(new Date(2026, 7, 29, 6, 0, 0).getTime(), NOW) === '前天 06:00:00');
check('三天前（今年）显 MM-DD', logTimestamp(new Date(2026, 7, 28, 8, 0, 0).getTime(), NOW) === '08-28 08:00:00');
check('跨年补年份', logTimestamp(new Date(2025, 11, 31, 23, 59, 59).getTime(), NOW) === '2025-12-31 23:59:59');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
