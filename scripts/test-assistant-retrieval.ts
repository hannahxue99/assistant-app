import { rankRelevantEntries, rankRelevantSegments, scoreTextRelevance } from '../src/assistant/retrieval';
import type { Entry } from '../src/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(scoreTextRelevance('照片整理', '周四继续照片整理') === 1, '完整短语命中应为最高相关');
check(scoreTextRelevance('照片整理', '照片备份计划') > scoreTextRelevance('照片整理', '季度评审计划'),
  '局部语义重叠应高于宽泛尾词重叠');

const segments = rankRelevantSegments('照片整理', [
  { id: 'travel', summary: '讨论旅行路线和酒店', status: 'closed', startedAt: 1, endedAt: 2, updatedAt: 2 },
  { id: 'photo', summary: '用户计划分批整理手机照片，先筛废片', status: 'closed', startedAt: 3, endedAt: 4, updatedAt: 4 },
]);
check(segments.length === 1 && segments[0].id === 'photo', '无关历史分段不得污染上下文');

function entry(id: string, rawText: string, summary: string, updatedAt: number): Entry {
  return {
    id, rawText, summary, updatedAt, createdAt: updatedAt, revisionAt: updatedAt,
    kind: 'info', dueAt: null, remindAt: null, topic: null, tags: [], persons: [],
    parseStatus: 'ok', parseSource: 'rule', correctedFrom: null, done: 0, doneAt: null, source: 'text',
  };
}

const entries = rankRelevantEntries('项目评审', [
  entry('old', '这个项目下周评审', '安排项目评审', 1),
  entry('noise', '评审一下照片吧', '照片筛选', 2),
]);
check(entries[0].id === 'old', '完整主题命中必须排在局部噪声之前');

console.log('assistant retrieval tests passed');
