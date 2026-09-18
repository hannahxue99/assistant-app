import {
  executeAssistantReadToolWithDatabase,
  mergeAssistantReadSets,
} from '../src/assistant/data-tools';
import { buildAssistantExecutionResult, fallbackReplyForExecution } from '../src/assistant/execution-result';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const fakeDb = {
  async getAllAsync<T>(sql: string): Promise<T[]> {
    if (sql.includes('FROM assistant_events')) {
      return [{ id: 'event-trip', title: '十一出行', current_state: '已定演出', status: 'active', revision: 3, updated_at: 30 }] as T[];
    }
    return [];
  },
  async getFirstAsync<T>(): Promise<T | null> { return null; },
};

async function main() {
  const search = await executeAssistantReadToolWithDatabase(fakeDb, {
    id: 'call-1', name: 'search_events', argumentsJson: '{"query":"十一出行"}',
  });
  check(search.readEventIds.length === 0, '搜索结果只能发现候选，不能视为完整读取并授权写入');
  check((search.result.events as any[])[0].revision === 3, '工具结果必须返回真实 revision');

  const merged = mergeAssistantReadSets([
    search,
    {
      toolCallId: 'call-2', name: 'get_todo', result: {},
      readEventIds: ['event-trip'], readTodoIds: ['todo-train'], readMemoryIds: [],
    },
  ]);
  check(merged.eventIds.length === 1 && merged.todoIds[0] === 'todo-train', '读取集合只能合并精确详情读取并去重');

  const memorySearch = await executeAssistantReadToolWithDatabase(fakeDb, {
    id: 'call-memory-search', name: 'search_memories', argumentsJson: '{"query":"例假"}',
  });
  check(memorySearch.readMemoryIds.length === 0, '记忆搜索只能发现候选，不能授权修改');

  await executeAssistantReadToolWithDatabase(fakeDb, {
    id: 'call-3', name: 'search_events', argumentsJson: '{"query":"火车"}',
  });
  await (async () => {
    try {
      await executeAssistantReadToolWithDatabase(fakeDb, {
        id: 'call-4', name: 'delete_event', argumentsJson: '{}',
      });
      throw new Error('未拒绝写工具');
    } catch (error: any) {
      check(error.code === 'tool_not_allowed', '数据工具层只允许只读工具');
    }
  })();

  const rejected = buildAssistantExecutionResult({
    operations: [], rejected: [{ type: 'update_event', reason: 'revision_conflict' }],
  });
  check(rejected.outcome === 'rejected', '零写入且有拒绝项不能记录为 committed');
  check(!fallbackReplyForExecution(rejected).includes('已更新'), '拒绝兜底文案不得虚报成功');

  const committed = buildAssistantExecutionResult({
    operations: [{
      id: 'op-1', requestId: 'r-1', operationKey: 'k-1', operationType: 'update_event',
      objectType: 'event', objectId: 'event-trip', beforeSnapshot: null, afterSnapshot: '{}',
      receiptSummary: '已更新十一出行', status: 'committed', sequence: 0, createdAt: 1, undoneAt: null,
    }],
  });
  check(fallbackReplyForExecution(committed) === '已更新十一出行', '成功兜底必须只来自真实操作回执');
  console.log('assistant data tools tests passed');
}

void main();
