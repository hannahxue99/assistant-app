import { entryActivityAt, wasEntryEdited } from '../src/engine/entry-time';

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${name}: ${String(actual)} !== ${String(expected)}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

check('新记录未被编辑', wasEntryEdited({ createdAt: 100, updatedAt: 100 }), false);
check('修改后的记录被识别为已编辑', wasEntryEdited({ createdAt: 100, updatedAt: 200 }), true);
check('内容活动时间取 updatedAt', entryActivityAt({ updatedAt: 200 }), 200);

console.log(`\n结果：${passed} 通过，0 失败`);
