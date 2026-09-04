import { buildEveningCopy, buildMorningCopy } from '../src/engine/notification-copy';
import type { Entry } from '../src/types';

const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime();
const DAY = 86400000;

function entry(id: string, dueAt: number | null, done: 0 | 1 = 0): Entry {
  return {
    id, rawText: id, summary: id, kind: 'task', dueAt, remindAt: dueAt,
    topic: null, tags: [], persons: [], parseStatus: 'ok', parseSource: 'rule',
    correctedFrom: null, createdAt: NOW, updatedAt: NOW, revisionAt: NOW,
    done, doneAt: null, source: 'text',
  };
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

const today = entry('今天买牛肉', new Date(2026, 8, 2, 15).getTime());
const tomorrow = entry('明天还书', new Date(2026, 8, 3, 9).getTime());
const day5 = entry('周内复诊', NOW + 5 * DAY);
const day10 = entry('十天后办事', NOW + 10 * DAY);
const done = entry('已完成', NOW + DAY, 1);
const overdue = entry('已逾期', NOW - DAY);

check('晨问优先今天', buildMorningCopy([day10, tomorrow, today], NOW)?.source === 'today');
check('晨问今天为空取本周', buildMorningCopy([day10, tomorrow], NOW)?.source === 'week');
check('晨问本周为空取最近', buildMorningCopy([day10], NOW)?.source === 'nearest');
check('晨问忽略完成和逾期', buildMorningCopy([done, overdue], NOW) === null);
check('夜间跳过今天，取明天起本周', buildEveningCopy([today, tomorrow, day5], NOW)?.entries[0].id === '明天还书');
check('夜间本周为空取最近', buildEveningCopy([day10], NOW)?.source === 'nearest');
check('最多展示5条', buildMorningCopy(Array.from({ length: 8 }, (_, i) => entry(`任务${i}`, NOW + DAY)), NOW)!.entries.length === 5);
check('无可提醒待办不生成通知', buildEveningCopy([], NOW) === null);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
