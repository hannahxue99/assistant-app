import {
  buildImportDecisions,
  buildMemoryImportDecisions,
  classifyMemoryImport,
  classifyEntryImport,
  summarizeImport,
} from '../src/engine/import-merge';
import type { BackupPayload, Entry, Profile } from '../src/types';
import type { AssistantMemory } from '../src/assistant/memory-types';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'same-id', rawText: '原文', kind: 'info', summary: '标题', dueAt: null, remindAt: null,
    topic: '主题', tags: [], persons: [], parseStatus: 'ok', parseSource: 'llm', correctedFrom: null,
    createdAt: 100, updatedAt: 100, revisionAt: 100, done: 0, doneAt: null, source: 'text',
    ...overrides,
  };
}

const defaultProfile: Profile = {
  name: '', goals: [], avoid: [], notifyMorning: true, notifyEvening: true,
};

function payload(entries: Entry[]): BackupPayload {
  return {
    entries,
    profile: { ...defaultProfile, name: '小雪' },
    topicPreferences: [],
  };
}

function memory(overrides: Partial<AssistantMemory> = {}): AssistantMemory {
  return {
    id: 'memory-1', category: 'preference', content: '不喜欢早会', normalizedContent: '不喜欢早会',
    status: 'active', sensitivity: 'ordinary', admissionBasis: 'explicit', supersededById: null,
    revision: 1, createdAt: 100, updatedAt: 100, activatedAt: 100, supersededAt: null, forgottenAt: null,
    ...overrides,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${String(actual)} !== ${String(expected)}`);
}

check('本地缺失时新增', () => equal(classifyEntryImport(entry(), null).action, 'add'));
check('业务内容相同但版本时间不同仍忽略', () => {
  equal(classifyEntryImport(entry({ revisionAt: 200 }), entry({ revisionAt: 100 })).action, 'ignore');
});
check('导入版本更新时覆盖本地并标记冲突历史', () => {
  const decision = classifyEntryImport(
    entry({ summary: '新标题', revisionAt: 200 }),
    entry({ summary: '旧标题', revisionAt: 100 }),
  );
  equal(decision.action, 'update');
  equal(decision.hasConflict, true);
});
check('本地版本更新时保留本地', () => {
  equal(classifyEntryImport(
    entry({ summary: '旧标题', revisionAt: 100 }),
    entry({ summary: '新标题', revisionAt: 200 }),
  ).action, 'keep-local');
});
check('版本时间相同但内容不同时保留本地', () => {
  const decision = classifyEntryImport(entry({ summary: '导入标题' }), entry({ summary: '本地标题' }));
  equal(decision.action, 'keep-local');
  equal(decision.reason, 'same_revision');
});
check('预览分类计数且默认画像可恢复', () => {
  const incoming = [
    entry({ id: 'add' }),
    entry({ id: 'update', summary: '导入新', revisionAt: 300 }),
    entry({ id: 'ignore' }),
    entry({ id: 'conflict', summary: '导入旧', revisionAt: 100 }),
  ];
  const local = [
    entry({ id: 'update', summary: '本地旧', revisionAt: 200 }),
    entry({ id: 'ignore', revisionAt: 500 }),
    entry({ id: 'conflict', summary: '本地新', revisionAt: 200 }),
  ];
  const summary = summarizeImport(buildImportDecisions(incoming, local), defaultProfile, payload(incoming));
  equal(summary.added, 1);
  equal(summary.updated, 1);
  equal(summary.ignored, 1);
  equal(summary.conflicts, 1);
  equal(summary.profileWillImport, true);
});
check('重复导入相同数据全部忽略', () => {
  const entries = [entry({ id: '1' }), entry({ id: '2' })];
  const decisions = buildImportDecisions(entries, entries);
  equal(decisions.every((decision) => decision.action === 'ignore'), true);
});
check('长期记忆按 revision、更新时间保守合并', () => {
  equal(classifyMemoryImport(memory(), null).action, 'add');
  equal(classifyMemoryImport(memory({ revision: 2 }), memory({ revision: 1 })).action, 'update');
  equal(classifyMemoryImport(memory({ revision: 1 }), memory({ revision: 2 })).action, 'keep-local');
  equal(classifyMemoryImport(memory({ content: '新内容', updatedAt: 200 }), memory()).action, 'update');
  equal(buildMemoryImportDecisions([memory()], [memory()])[0].action, 'ignore');
});

console.log(`\n结果：${passed} 通过，0 失败`);
