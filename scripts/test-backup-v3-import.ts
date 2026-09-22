import {
  buildBackupV3ImportPlan,
  type BackupV3LocalState,
} from '../src/engine/backup-v3-import';
import type { BackupPayloadV3 } from '../src/engine/backup-v3-format';
import type { Entry } from '../src/types';

function todo(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'todo-1', rawText: '交报告', kind: 'task', summary: '交报告', dueAt: null,
    timePrecision: 'date', remindAt: null, topic: null, tags: [], persons: [],
    parseStatus: 'ok', parseSource: 'llm', correctedFrom: null, createdAt: 100,
    updatedAt: 100, revisionAt: 100, done: 0, doneAt: null, source: 'text',
    ...overrides,
  };
}

function emptyPayload(): BackupPayloadV3 {
  return {
    entries: [],
    profile: { name: '', goals: [], avoid: [], notifyMorning: true, notifyEvening: true },
    topicPreferences: [], conversationSegments: [], assistantRequests: [], assistantMessages: [],
    events: [], eventAliases: [], eventUpdates: [], objectRelations: [], operations: [],
    memories: [], memorySources: [],
  };
}

function localState(overrides: Partial<BackupV3LocalState> = {}): BackupV3LocalState {
  return { ...emptyPayload(), ...overrides };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function equal(actual: unknown, expected: unknown, label = 'value') {
  if (actual !== expected) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
}

check('不可变事实按 ID 新增、忽略或保留本地冲突', () => {
  const incoming = emptyPayload();
  incoming.events = [{
    id: 'event-1', title: '报告', currentState: '', status: 'active', pinnedAt: null,
    revision: 1, createdAt: 100, updatedAt: 100,
  }];
  incoming.eventAliases = [
    { id: 'alias-add', eventId: 'event-1', alias: '新增', createdAt: 100 },
    { id: 'alias-same', eventId: 'event-1', alias: '相同', createdAt: 100 },
    { id: 'alias-conflict', eventId: 'event-1', alias: '导入', createdAt: 100 },
  ];
  const local = localState({
    events: incoming.events,
    eventAliases: [
      { id: 'alias-same', eventId: 'event-1', alias: '相同', createdAt: 100 },
      { id: 'alias-conflict', eventId: 'event-1', alias: '本地', createdAt: 100 },
    ],
  });
  const plan = buildBackupV3ImportPlan(incoming, local);
  equal(plan.eventAliases.map(item => item.action).join(','), 'add,ignore,keep-local');
  equal(plan.conflicts.length, 1);
});

check('版本对象按各自 revision 规则合并', () => {
  const incoming = emptyPayload();
  incoming.entries = [
    todo({ id: 'add' }),
    todo({ id: 'update', summary: '导入新', revisionAt: 300 }),
    todo({ id: 'local', summary: '导入旧', revisionAt: 100 }),
  ];
  incoming.events = [{
    id: 'event-1', title: '导入新', currentState: '', status: 'active', pinnedAt: null,
    revision: 2, createdAt: 100, updatedAt: 200,
  }];
  const local = localState({
    entries: [todo({ id: 'update', summary: '本地旧', revisionAt: 200 }), todo({ id: 'local', summary: '本地新', revisionAt: 200 })],
    events: [{ ...incoming.events[0], title: '本地旧', revision: 1 }],
  });
  const plan = buildBackupV3ImportPlan(incoming, local);
  equal(plan.entries.map(item => item.action).join(','), 'add,update,keep-local');
  equal(plan.events[0].action, 'update');
  equal(plan.conflicts.length, 3);
});

check('非空本地库保留当前分段并将导入当前分段关闭', () => {
  const incoming = emptyPayload();
  incoming.conversationSegments = [{
    id: 'incoming-current', summary: '', status: 'current', startedAt: 100, endedAt: null, updatedAt: 200,
  }];
  const local = localState({ conversationSegments: [{
    id: 'local-current', summary: '', status: 'current', startedAt: 300, endedAt: null, updatedAt: 300,
  }] });
  const plan = buildBackupV3ImportPlan(incoming, local);
  equal(plan.conversationSegments[0].action, 'add');
  equal(plan.conversationSegments[0].incoming.status, 'closed');
  equal(plan.conversationSegments[0].incoming.endedAt, 200);
  equal(plan.conversationSegments[0].reason, 'local_current_preserved');
});

check('用户消息冲突时整组请求、助手消息和操作跳过', () => {
  const incoming = emptyPayload();
  incoming.conversationSegments = [{ id: 'segment-1', summary: '', status: 'closed', startedAt: 100, endedAt: 200, updatedAt: 200 }];
  incoming.assistantRequests = [{
    id: 'request-1', userMessageId: 'message-user', status: 'succeeded', errorCode: null,
    attemptCount: 1, createdAt: 100, updatedAt: 200,
  }];
  incoming.assistantMessages = [{
    id: 'message-user', requestId: 'request-1', role: 'user', content: '导入内容', source: 'text',
    status: 'saved', segmentId: 'segment-1', legacyEntryId: null, stageDurations: {}, createdAt: 100, updatedAt: 100,
  }, {
    id: 'message-assistant', requestId: 'request-1', role: 'assistant', content: '回复', source: 'assistant',
    status: 'saved', segmentId: 'segment-1', legacyEntryId: null, stageDurations: {}, createdAt: 200, updatedAt: 200,
  }];
  incoming.entries = [todo()];
  incoming.operations = [{
    id: 'operation-1', requestId: 'request-1', operationKey: 'todo', operationType: 'create_todo',
    objectType: 'todo', objectId: 'todo-1', beforeSnapshot: null, afterSnapshot: JSON.stringify(todo()),
    receiptSummary: '建立待办', status: 'committed', sequence: 0, createdAt: 200, undoneAt: null,
  }];
  const local = localState({
    conversationSegments: incoming.conversationSegments,
    assistantRequests: incoming.assistantRequests,
    assistantMessages: [{ ...incoming.assistantMessages[0], content: '本地内容' }],
  });
  const plan = buildBackupV3ImportPlan(incoming, local);
  equal(plan.assistantRequests[0].action, 'skip-group');
  equal(plan.assistantMessages.every(item => item.action === 'skip-group'), true);
  equal(plan.operations[0].action, 'skip');
});

check('操作仅在目标等于 afterSnapshot 时恢复', () => {
  const incoming = emptyPayload();
  const target = todo();
  incoming.entries = [target];
  incoming.operations = [{
    id: 'operation-ok', requestId: 'request-1', operationKey: 'ok', operationType: 'create_todo',
    objectType: 'todo', objectId: target.id, beforeSnapshot: null, afterSnapshot: JSON.stringify(target),
    receiptSummary: '建立待办', status: 'committed', sequence: 0, createdAt: 200, undoneAt: null,
  }, {
    id: 'operation-stale', requestId: 'request-1', operationKey: 'stale', operationType: 'update_todo',
    objectType: 'todo', objectId: target.id, beforeSnapshot: null,
    afterSnapshot: JSON.stringify({ ...target, summary: '旧状态' }), receiptSummary: '更新待办',
    status: 'committed', sequence: 1, createdAt: 201, undoneAt: null,
  }];
  incoming.conversationSegments = [{ id: 'segment-1', summary: '', status: 'closed', startedAt: 100, endedAt: 200, updatedAt: 200 }];
  incoming.assistantRequests = [{ id: 'request-1', userMessageId: 'message-user', status: 'succeeded', errorCode: null, attemptCount: 1, createdAt: 100, updatedAt: 200 }];
  incoming.assistantMessages = [{
    id: 'message-user', requestId: 'request-1', role: 'user', content: '建立待办', source: 'text',
    status: 'saved', segmentId: 'segment-1', legacyEntryId: null, stageDurations: {}, createdAt: 100, updatedAt: 100,
  }];
  const plan = buildBackupV3ImportPlan(incoming, localState());
  equal(plan.operations.map(item => item.action).join(','), 'add,skip');
  equal(plan.preview.operationSkipped, 1);
});

check('真实删除、事件进展和记忆替代快照按语义状态恢复', () => {
  const incoming = emptyPayload();
  const event = {
    id: 'event-1', title: '报告', currentState: '已结束', status: 'closed' as const,
    pinnedAt: null, revision: 3, createdAt: 100, updatedAt: 300,
  };
  const appendedUpdate = {
    id: 'update-appended', eventId: event.id, content: '已提交', occurredAt: 250,
    sourceMessageId: 'message-user', stableKey: 'request-1:append', createdAt: 250, undoneAt: null,
  };
  const deletedUpdate = {
    id: 'update-deleted', eventId: event.id, content: '旧进展', occurredAt: 150,
    sourceMessageId: 'message-user', stableKey: 'request-1:delete-update', createdAt: 150, undoneAt: 300,
  };
  const oldMemory = {
    id: 'memory-old', category: 'preference' as const, content: '旧偏好', normalizedContent: '旧偏好',
    status: 'superseded' as const, sensitivity: 'ordinary' as const, admissionBasis: 'explicit' as const,
    supersededById: 'memory-new', revision: 2, createdAt: 100, updatedAt: 300,
    activatedAt: 100, supersededAt: 300, forgottenAt: null,
  };
  const successor = {
    ...oldMemory, id: 'memory-new', content: '新偏好', normalizedContent: '新偏好',
    status: 'active' as const, supersededById: null, revision: 1, createdAt: 300,
    activatedAt: 300, supersededAt: null,
  };
  incoming.conversationSegments = [{
    id: 'segment-1', summary: '', status: 'closed', startedAt: 100, endedAt: 300, updatedAt: 300,
  }];
  incoming.assistantRequests = [{
    id: 'request-1', userMessageId: 'message-user', status: 'succeeded', errorCode: null,
    attemptCount: 1, createdAt: 100, updatedAt: 300,
  }];
  incoming.assistantMessages = [{
    id: 'message-user', requestId: 'request-1', role: 'user', content: '整理这些内容', source: 'text',
    status: 'saved', segmentId: 'segment-1', legacyEntryId: null, stageDurations: {}, createdAt: 100, updatedAt: 100,
  }];
  incoming.events = [event];
  incoming.eventUpdates = [appendedUpdate, deletedUpdate];
  incoming.memories = [oldMemory, successor];
  incoming.operations = [
    {
      id: 'operation-delete-todo', requestId: 'request-1', operationKey: 'delete-todo', operationType: 'delete_todo',
      objectType: 'todo', objectId: 'todo-deleted', beforeSnapshot: null,
      afterSnapshot: JSON.stringify({ deleted: true, todoId: 'todo-deleted', revisionAt: 100 }),
      receiptSummary: '删除待办', status: 'committed', sequence: 0, createdAt: 300, undoneAt: null,
    },
    {
      id: 'operation-delete-event', requestId: 'request-1', operationKey: 'delete-event', operationType: 'delete_event',
      objectType: 'event', objectId: event.id, beforeSnapshot: null,
      afterSnapshot: JSON.stringify({ event, deletedTodoIds: ['todo-deleted'] }),
      receiptSummary: '删除事件', status: 'committed', sequence: 1, createdAt: 300, undoneAt: null,
    },
    {
      id: 'operation-append', requestId: 'request-1', operationKey: 'append', operationType: 'append_event_update',
      objectType: 'event_update', objectId: appendedUpdate.id, beforeSnapshot: null,
      afterSnapshot: JSON.stringify({ update: appendedUpdate, event }),
      receiptSummary: '追加进展', status: 'committed', sequence: 2, createdAt: 300, undoneAt: null,
    },
    {
      id: 'operation-delete-update', requestId: 'request-1', operationKey: 'delete-update', operationType: 'delete_event_update',
      objectType: 'event_update', objectId: deletedUpdate.id, beforeSnapshot: null,
      afterSnapshot: JSON.stringify({ event }),
      receiptSummary: '删除进展', status: 'committed', sequence: 3, createdAt: 300, undoneAt: null,
    },
    {
      id: 'operation-supersede', requestId: 'request-1', operationKey: 'supersede', operationType: 'supersede_memory',
      objectType: 'memory', objectId: oldMemory.id, beforeSnapshot: null,
      afterSnapshot: JSON.stringify({ old: oldMemory, successor }),
      receiptSummary: '更新记忆', status: 'committed', sequence: 4, createdAt: 300, undoneAt: null,
    },
  ];
  const plan = buildBackupV3ImportPlan(incoming, localState());
  equal(plan.operations.map(item => item.action).join(','), 'add,add,add,add,add');
  equal(plan.preview.operationSkipped, 0);
});

check('重复导入相同 V3 全部忽略', () => {
  const incoming = emptyPayload();
  incoming.entries = [todo()];
  incoming.events = [{ id: 'event-1', title: '报告', currentState: '', status: 'active', pinnedAt: null, revision: 1, createdAt: 100, updatedAt: 100 }];
  const plan = buildBackupV3ImportPlan(incoming, localState(incoming));
  equal(plan.entries[0].action, 'ignore');
  equal(plan.events[0].action, 'ignore');
  equal(plan.preview.added + plan.preview.updated + plan.preview.conflicts, 0);
});

console.log(`\n结果：${passed} 通过，0 失败`);
