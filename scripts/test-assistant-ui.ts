import { mergeAssistantMessages } from '../src/assistant/ui-state';
import { ASSISTANT_EMPTY_DESCRIPTION } from '../src/assistant/ui-copy';
import type { AssistantMessage } from '../src/assistant/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function message(id: string, createdAt: number, content = id): AssistantMessage {
  return {
    id,
    requestId: `request-${id}`,
    role: 'user',
    content,
    source: 'text',
    status: 'saved',
    segmentId: 'segment',
    createdAt,
    updatedAt: createdAt,
    legacyEntryId: null,
  };
}

const current = [message('b', 2), message('c', 3, '旧内容')];
const latest = [message('c', 3, '新内容'), message('d', 4)];
const merged = mergeAssistantMessages(current, latest);
check(merged.map(item => item.id).join(',') === 'b,c,d', '刷新时必须去重并按稳定时间顺序合并');
check(merged[1].content === '新内容', '相同 id 应采用 updatedAt 不更旧的版本');

const sameTime = mergeAssistantMessages([message('z', 10)], [message('a', 10)]);
check(sameTime.map(item => item.id).join(',') === 'a,z', '同一时间使用 id 保证稳定顺序');

check(
  ASSISTANT_EMPTY_DESCRIPTION === '我会记住前后文，陪你把事情一步步理清。',
  '首次进入说明应使用已确认的用户语言',
);
check(!/记录|待办|困惑/.test(ASSISTANT_EMPTY_DESCRIPTION), '首次进入说明不应暴露内部分类');

console.log('assistant UI state tests passed');
