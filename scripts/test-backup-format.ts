import {
  BackupFormatError,
  buildImportableMarkdown,
  parseImportableMarkdown,
} from '../src/engine/backup-format';
import type { BackupPayload, Entry } from '../src/types';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    rawText: '周六预约牙医',
    kind: 'task',
    summary: '预约牙医',
    dueAt: 1788570000000,
    remindAt: 1788570000000,
    topic: '健康管理',
    tags: ['牙医', '预约'],
    persons: [],
    parseStatus: 'ok',
    parseSource: 'llm',
    correctedFrom: null,
    createdAt: 1788500000000,
    updatedAt: 1788500000000,
    revisionAt: 1788500001000,
    done: 0,
    doneAt: null,
    source: 'voice',
    ...overrides,
  };
}

function payload(entries: Entry[] = [entry()]): BackupPayload {
  return {
    entries,
    profile: {
      name: '小雪',
      goals: ['规律运动'],
      avoid: ['熬夜'],
      notifyMorning: true,
      notifyEvening: false,
    },
    topicPreferences: [{ topic: '健康管理', pinnedAt: 1788500002000 }],
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  x   ${name}`);
    throw error;
  }
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof BackupFormatError && error.code === code) return;
    throw error;
  }
  throw new Error(`expected BackupFormatError(${code})`);
}

check('中文内容和全部字段可往返恢复', () => {
  const expected = payload();
  const md = buildImportableMarkdown('# 我的个人助手记录\n\n可读内容', expected, 1788514200000);
  const actual = parseImportableMarkdown(md);
  if (!md.startsWith('# 我的个人助手记录\n\n可读内容')) throw new Error('readable markdown changed');
  if (JSON.stringify(actual.payload) !== JSON.stringify(expected)) throw new Error('payload mismatch');
  if (actual.exportedAt !== 1788514200000) throw new Error('exportedAt mismatch');
});

check('原文包含注释结束符时仍可安全往返', () => {
  const expected = payload([entry({ rawText: '保留 --> 这个文本 -- 不截断' })]);
  const md = buildImportableMarkdown('# 记录', expected, 1788514200000);
  if (md.split('ASSISTANT_APP_EXPORT_END').length !== 2) throw new Error('capsule marker collision');
  if (parseImportableMarkdown(md).payload.entries[0].rawText !== expected.entries[0].rawText) {
    throw new Error('special text mismatch');
  }
});

check('没有 V2 数据胶囊时识别为旧版或未知文件', () => {
  expectCode(() => parseImportableMarkdown('# 我的个人助手记录\n\n## 待办'), 'LEGACY_OR_UNKNOWN');
});

check('拒绝高于当前能力的格式版本', () => {
  const md = buildImportableMarkdown('# 记录', payload(), 1788514200000)
    .replace('"schemaVersion":2', '"schemaVersion":3');
  expectCode(() => parseImportableMarkdown(md), 'UNSUPPORTED_VERSION');
});

check('拒绝重复记录 ID', () => {
  const duplicate = payload([entry(), entry({ rawText: '重复 ID' })]);
  const md = buildImportableMarkdown('# 记录', duplicate, 1788514200000);
  expectCode(() => parseImportableMarkdown(md), 'INVALID_DATA');
});

check('拒绝损坏或字段类型错误的数据', () => {
  const md = buildImportableMarkdown('# 记录', payload(), 1788514200000)
    .replace('"kind":"task"', '"kind":"other"');
  expectCode(() => parseImportableMarkdown(md), 'INVALID_DATA');
});

console.log(`\n结果：${passed} 通过，0 失败`);
