/**
 * 时间解析器回归测试 — 在电脑上先测，不上手机
 * 用法：npx tsx scripts/test-time.ts（有断言失败时退出码非 0）
 *
 * 双基线：
 * - FRI  2026-08-28（周五）17:30 — 既有用例
 * - MON  2026-08-31（周一）10:00 — 覆盖「下周X」从周初说的场景
 *   （旧算法在周一说"下周三"会解析成本周三，提前一周，此为回归项）
 * - WED  2026-09-02（周三）14:00 — 覆盖本周/裸星期/月末/下月序数星期
 */
import { parseChineseTime, hasTimeHint } from '../src/engine/time';

const FRI = new Date(2026, 7, 28, 17, 30).getTime(); // 周五 17:30
const MON = new Date(2026, 7, 31, 10, 0).getTime();  // 周一 10:00
const WED = new Date(2026, 8, 2, 14, 0).getTime();   // 周三 14:00

function ts(y: number, mo: number, d: number, h: number, mi = 0): number {
  return new Date(y, mo, d, h, mi).getTime();
}

interface Case {
  input: string;
  now: number;
  expect: number | null;
  expectHint?: boolean;
}

const cases: Case[] = [
  // --- 周五基线（既有用例） ---
  { input: '明天下午3点开会', now: FRI, expect: ts(2026, 7, 29, 15, 0) },
  { input: '后天上午10点提交报告', now: FRI, expect: ts(2026, 7, 30, 10, 0) },
  { input: '周末去买菜', now: FRI, expect: ts(2026, 7, 29, 9, 0) }, // 周六
  { input: '晚上8点记得吃药', now: FRI, expect: ts(2026, 7, 28, 20, 0) },
  { input: '今晚10点跟美国团队开会', now: FRI, expect: ts(2026, 7, 28, 22, 0) },
  { input: '下周三下午跟小王碰方案', now: FRI, expect: ts(2026, 8, 2, 14, 0) },
  { input: '10月15日老婆生日', now: FRI, expect: ts(2026, 9, 15, 9, 0) },
  { input: '10.1买牛肉', now: FRI, expect: ts(2026, 9, 1, 9, 0) },
  { input: '10．2买水果', now: FRI, expect: ts(2026, 9, 2, 9, 0) },
  { input: '明天上午9点半提醒我给老师回电话', now: FRI, expect: ts(2026, 7, 29, 9, 30) },
  { input: '明天下午跟小王碰一下方案的事别忘了', now: FRI, expect: ts(2026, 7, 29, 14, 0) },
  { input: '有个想法：做个语音助手', now: FRI, expect: null, expectHint: false },
  { input: 'wifi密码是abc123', now: FRI, expect: null, expectHint: false },
  { input: '上周记录学到第30本绘本', now: FRI, expect: null, expectHint: false }, // 过去时不挂提醒

  // --- 周一基线（回归：「下周X」从周初说） ---
  { input: '下周三开会', now: MON, expect: ts(2026, 8, 9, 9, 0) },   // 9/9 下周三
  { input: '下周三下午3点开会', now: MON, expect: ts(2026, 8, 9, 15, 0) },
  { input: '下周一交报告', now: MON, expect: ts(2026, 8, 7, 9, 0) },   // 9/7 下周一
  { input: '下周五之前把这事定了', now: MON, expect: ts(2026, 8, 11, 9, 0) }, // 9/11 下周五
  { input: '下下周三检查进度', now: MON, expect: ts(2026, 8, 16, 9, 0) }, // 9/16 下下周三
  { input: '明天下午跟小王碰一下方案的事', now: MON, expect: ts(2026, 8, 1, 14, 0) },
  { input: '下午3点有个会', now: MON, expect: ts(2026, 7, 31, 15, 0) },
  { input: '上午9点开过会了', now: MON, expect: ts(2026, 7, 31 + 1, 9, 0) }, // 已过 → 推明天

  // --- 周三基线（本周/裸星期/月末/下月序数星期） ---
  { input: '本周日给优优过生日', now: WED, expect: ts(2026, 8, 6, 9, 0) },
  { input: '这周六下午3点去郊游', now: WED, expect: ts(2026, 8, 5, 15, 0) },
  { input: '本周三晚上8点开会', now: WED, expect: ts(2026, 8, 2, 20, 0) },
  { input: '本周二交材料', now: WED, expect: ts(2026, 8, 1, 9, 0) }, // 明确本周，允许过去日期
  { input: '周五取快递', now: WED, expect: ts(2026, 8, 4, 9, 0) },
  { input: '周三下午3点开会', now: WED, expect: ts(2026, 8, 2, 15, 0) },
  { input: '周三上午9点开会', now: WED, expect: ts(2026, 8, 9, 9, 0) }, // 今天已过点 → 下周三
  { input: '月底之前把房租交了', now: WED, expect: ts(2026, 8, 30, 9, 0) },
  { input: '下月底做月度复盘', now: WED, expect: ts(2026, 9, 31, 9, 0) },
  { input: '下个月第一个周一开始准备述职', now: WED, expect: ts(2026, 9, 5, 9, 0) },
  { input: '下个月最后一个周五复盘', now: WED, expect: ts(2026, 9, 30, 9, 0) },
  { input: '过几天找小王聊聊', now: WED, expect: null, expectHint: false },
  { input: '国庆后给车做保养', now: WED, expect: null, expectHint: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = parseChineseTime(c.input, c.now);
  const hint = hasTimeHint(c.input);
  const dueOk = r.dueAt === c.expect || Math.abs((r.dueAt ?? -1) - (c.expect ?? -2)) === 0;
  const hintOk = c.expectHint === undefined || hint === c.expectHint;
  const label = new Date(c.now).toDateString();
  if (dueOk && hintOk) {
    pass++;
    console.log(`✓ 「${c.input}」 [${label}]`);
  } else {
    fail++;
    const got = r.dueAt ? new Date(r.dueAt).toLocaleString('zh-CN') : '（无）';
    const want = c.expect ? new Date(c.expect).toLocaleString('zh-CN') : '（无）';
    console.log(`✗ 「${c.input}」 [${label}]`);
    console.log(`    期望 ${want}，实际 ${got}${hintOk ? '' : `；hint 期望 ${c.expectHint} 实际 ${hint}`}`);
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
