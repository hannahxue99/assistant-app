import {
  BackupV3FormatError,
  buildBackupV3Markdown,
  parseBackupV3Markdown,
  type BackupPayloadV3,
} from '../src/engine/backup-v3-format';

function payload(): BackupPayloadV3 {
  return {
    entries: [{
      id: 'todo-1', rawText: '明天交报告', kind: 'task', summary: '交报告', dueAt: 2000,
      timePrecision: 'dateTime', remindAt: 1900, topic: '工作', tags: ['报告'], persons: [],
      parseStatus: 'ok', parseSource: 'llm', correctedFrom: null, createdAt: 1000,
      updatedAt: 1000, revisionAt: 1000, done: 0, doneAt: null, source: 'text',
    }],
    profile: { name: '小雪', goals: ['规律生活'], avoid: ['熬夜'], notifyMorning: true, notifyEvening: false },
    topicPreferences: [{ topic: '工作', pinnedAt: 1100 }],
    conversationSegments: [{
      id: 'segment-1', summary: '报告安排', status: 'current', startedAt: 1000, endedAt: null, updatedAt: 1500,
    }],
    assistantRequests: [{
      id: 'request-1', userMessageId: 'message-user-1', status: 'succeeded', errorCode: null,
      attemptCount: 1, createdAt: 1200, updatedAt: 1500,
    }],
    assistantMessages: [{
      id: 'message-user-1', requestId: 'request-1', role: 'user', content: '帮我安排报告', source: 'text',
      status: 'saved', segmentId: 'segment-1', legacyEntryId: null, stageDurations: {}, createdAt: 1200, updatedAt: 1200,
    }, {
      id: 'message-assistant-1', requestId: 'request-1', role: 'assistant', content: '已经安排。', source: 'assistant',
      status: 'saved', segmentId: 'segment-1', legacyEntryId: null,
      stageDurations: { readingMs: 100, thinkingMs: 200, updatingMs: 50 }, createdAt: 1500, updatedAt: 1500,
    }],
    events: [{
      id: 'event-1', title: '报告', currentState: '撰写中', status: 'active', pinnedAt: null,
      revision: 1, createdAt: 1300, updatedAt: 1500,
    }],
    eventAliases: [{ id: 'alias-1', eventId: 'event-1', alias: '季度报告', createdAt: 1300 }],
    eventUpdates: [{
      id: 'update-1', eventId: 'event-1', content: '已建立待办', occurredAt: 1400,
      sourceMessageId: 'message-user-1', stableKey: 'request-1:update-1', createdAt: 1400, undoneAt: null,
    }],
    objectRelations: [{
      id: 'relation-1', fromType: 'todo', fromId: 'todo-1', relationType: 'belongs_to',
      toType: 'event', toId: 'event-1', sourceMessageId: 'message-user-1', createdAt: 1400, undoneAt: null,
    }],
    operations: [{
      id: 'operation-1', requestId: 'request-1', operationKey: 'todo', operationType: 'create_todo',
      objectType: 'todo', objectId: 'todo-1', beforeSnapshot: null, afterSnapshot: '{"id":"todo-1"}',
      receiptSummary: '建立待办：交报告', status: 'committed', sequence: 0, createdAt: 1400, undoneAt: null,
    }],
    memories: [{
      id: 'memory-1', category: 'preference', content: '先列提纲', normalizedContent: '先列提纲',
      status: 'active', sensitivity: 'ordinary', admissionBasis: 'explicit', supersededById: null,
      revision: 1, createdAt: 1250, updatedAt: 1250, activatedAt: 1250, supersededAt: null, forgottenAt: null,
    }],
    memorySources: [{
      id: 'memory-source-1', memoryId: 'memory-1', sourceMessageId: 'message-user-1',
      evidence: '先列提纲', createdAt: 1250,
    }],
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
    if (error instanceof BackupV3FormatError && error.code === code) return;
    throw error;
  }
  throw new Error(`expected BackupV3FormatError(${code})`);
}

check('V3 完整语义数据图可往返', () => {
  const expected = payload();
  const markdown = buildBackupV3Markdown('# 完整备份\n\n可读摘要', expected, 2000);
  const parsed = parseBackupV3Markdown(markdown);
  if (parsed.format !== 'assistant-app-export-v3' || parsed.schemaVersion !== 3) throw new Error('wrong version');
  if (parsed.exportedAt !== 2000) throw new Error('wrong exportedAt');
  if (JSON.stringify(parsed.payload) !== JSON.stringify(expected)) throw new Error('payload mismatch');
  for (const [kind, values] of Object.entries(expected)) {
    if (Array.isArray(values) && parsed.counts[kind as keyof typeof parsed.counts] !== values.length) {
      throw new Error(`count mismatch: ${kind}`);
    }
  }
  if (!markdown.includes('ASSISTANT_APP_EXPORT_V3')) throw new Error('missing V3 marker');
});

check('V2 文件交给调用方继续按 V2 解析', () => {
  expectCode(() => parseBackupV3Markdown('<!-- ASSISTANT_APP_EXPORT_V2\n{}\nASSISTANT_APP_EXPORT_END -->'), 'LEGACY_OR_UNKNOWN');
});

check('高于 V3 的格式明确提示版本过新', () => {
  const markdown = buildBackupV3Markdown('# 备份', payload(), 2000).replace('"schemaVersion":3', '"schemaVersion":4');
  expectCode(() => parseBackupV3Markdown(markdown), 'UNSUPPORTED_VERSION');
});

check('拒绝重复 ID 与悬空引用', () => {
  const duplicate = payload();
  duplicate.events.push({ ...duplicate.events[0] });
  expectCode(() => buildBackupV3Markdown('# 备份', duplicate), 'INVALID_DATA');

  const dangling = payload();
  dangling.eventUpdates[0].eventId = 'missing-event';
  expectCode(() => buildBackupV3Markdown('# 备份', dangling), 'INVALID_DATA');
});

check('拒绝请求消息错配与重复操作序号', () => {
  const mismatched = payload();
  mismatched.assistantRequests[0].userMessageId = 'message-assistant-1';
  expectCode(() => buildBackupV3Markdown('# 备份', mismatched), 'INVALID_DATA');

  const duplicateSequence = payload();
  duplicateSequence.operations.push({
    ...duplicateSequence.operations[0], id: 'operation-2', operationKey: 'event', objectType: 'event', objectId: 'event-1',
  });
  expectCode(() => buildBackupV3Markdown('# 备份', duplicateSequence), 'INVALID_DATA');
});

check('拒绝长期记忆替代环', () => {
  const cyclic = payload();
  cyclic.memories = [{ ...cyclic.memories[0], supersededById: 'memory-2' }, {
    ...cyclic.memories[0], id: 'memory-2', content: '后列提纲', normalizedContent: '后列提纲', supersededById: 'memory-1',
  }];
  expectCode(() => buildBackupV3Markdown('# 备份', cyclic), 'INVALID_DATA');
});

check('拒绝损坏计数且不包含敏感运行字段', () => {
  const markdown = buildBackupV3Markdown('# 备份', payload(), 2000);
  const damaged = markdown.replace('"entries":1', '"entries":2');
  expectCode(() => parseBackupV3Markdown(damaged), 'INVALID_DATA');
  for (const forbidden of ['llmKey', 'llmBaseUrl', 'assistant_reasoning', 'assistant_decision_logs', 'calendar_event_id', 'notification_id']) {
    if (markdown.includes(forbidden)) throw new Error(`forbidden field leaked: ${forbidden}`);
  }
});

console.log(`\n结果：${passed} 通过，0 失败`);
