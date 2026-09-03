import { sortTopicGroups } from '../src/engine/topic-order';
import type { Entry, TopicGroup } from '../src/types';

function entry(id: string, createdAt: number): Entry {
  return {
    id,
    rawText: id,
    kind: 'info',
    summary: id,
    dueAt: null,
    remindAt: null,
    topic: id,
    tags: [],
    persons: [],
    parseStatus: 'ok',
    parseSource: 'llm',
    correctedFrom: null,
    createdAt,
    updatedAt: createdAt,
    done: 0,
    doneAt: null,
    source: 'text',
  };
}

function group(topic: string, updatedAt: number, pinnedAt: number | null): TopicGroup {
  const latest = entry(topic, updatedAt);
  return { topic, latest, entries: [latest], updatedAt, pinnedAt };
}

let passed = 0;
function check(name: string, actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name}: ${actual.join(',')} !== ${expected.join(',')}`);
  }
  passed += 1;
  console.log(`  ok  ${name}`);
}

check(
  '置顶主题始终排在普通主题前',
  sortTopicGroups([group('普通新', 500, null), group('置顶旧', 100, 200)]).map((g) => g.topic),
  ['置顶旧', '普通新'],
);
check(
  '多个置顶按最近内容更新时间排序，与置顶操作时间无关',
  sortTopicGroups([group('先置顶', 500, 100), group('后置顶', 100, 300)]).map((g) => g.topic),
  ['先置顶', '后置顶'],
);
check(
  '普通主题按最新消息排序',
  sortTopicGroups([group('旧消息', 100, null), group('新消息', 500, null)]).map((g) => g.topic),
  ['新消息', '旧消息'],
);

console.log(`\n结果：${passed} 通过，0 失败`);
