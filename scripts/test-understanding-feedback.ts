import { shouldShowUnderstandingFailureBanner } from '../src/engine/understanding-feedback';
import type { ParseStatus } from '../src/types';

const now = new Date('2026-09-03T10:00:00+08:00').getTime();
let passed = 0;
let failed = 0;

function check(name: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  x   ${name}: expected ${expected}, got ${actual}`);
  }
}

function entry(parseStatus: ParseStatus, minutesAgo: number) {
  return { parseStatus, createdAt: now - minutesAgo * 60 * 1000 };
}

check(
  '最近10分钟3条失败触发页面提示',
  shouldShowUnderstandingFailureBanner([entry('failed', 1), entry('failed', 4), entry('failed', 9)], now),
  true,
);
check(
  '失败不足3条不触发',
  shouldShowUnderstandingFailureBanner([entry('failed', 1), entry('failed', 4), entry('ok', 5)], now),
  false,
);
check(
  '超过10分钟的失败不计入',
  shouldShowUnderstandingFailureBanner([entry('failed', 1), entry('failed', 4), entry('failed', 11)], now),
  false,
);
check(
  '处理中不计为失败',
  shouldShowUnderstandingFailureBanner([entry('failed', 1), entry('failed', 4), entry('pending', 5)], now),
  false,
);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);

