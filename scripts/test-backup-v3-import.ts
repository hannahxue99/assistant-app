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
