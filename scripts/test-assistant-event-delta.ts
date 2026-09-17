import { prepareAssistantActions } from '../src/assistant/event-delta';
import type { AssistantActionContext } from '../src/assistant/action-types';
import type { AssistantEventDelta } from '../src/assistant/event-delta-types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const referenceAt = new Date('2026-09-15T10:00:00+08:00').getTime();
const actionContext: AssistantActionContext = {
  events: [{
    id: 'event-loan', title: '公积金贷款还款',
    currentState: '已提前还款30万，剩余约30多万',
    aliases: [], linkedTodoTexts: ['每月正常还款'], recentUpdateTexts: ['已提前还款30万'],
    linkedTodos: [{
      id: 'todo-repay', text: '每月正常还款', dueAt: null, done: false,
      revisionAt: 10, updatedAt: 10,
    }],
    revision: 3, updatedAt: 10, score: 10,
  }],
  todos: [{
    id: 'todo-repay', text: '每月正常还款', dueAt: null,
    revisionAt: 10, updatedAt: 10, score: 10,
  }],
  explicitEventId: 'event-loan',
  segmentEventId: null,
};

function delta(overrides: Partial<AssistantEventDelta> = {}): AssistantEventDelta {
  return {
    key: 'loan-plan',
    target: { action: 'update_existing', eventId: 'event-loan' },
    evidence: ['下个月11号再还10万'],
    state: {
      action: 'replace', changeType: 'plan',
      value: '已提前还款30万，剩余约30多万；计划10月11日再还10万',
    },
    progress: [{ type: 'decision', content: '确定10月11日再还款10万' }],
    todos: [{
      action: 'create', todoRef: 'todo_1', text: '还款10万',
      dateStatus: 'resolved', dateText: '下个月11号', dueDate: '2026-10-11',
      timePrecision: 'date',
    }],
    ...overrides,
  };
}

const newPlan = prepareAssistantActions({
  operations: [], eventDeltas: [delta()], actionContext,
  currentMessage: '下个月11号再还10万', recentEvidence: [], referenceAt,
});
check(newPlan.rejected.length === 0, '完整的新计划增量应通过校验');
check(
  newPlan.accepted.map(operation => operation.type).join(',')
    === 'update_event,append_event_update,create_todo,link_todo_event',
  '新计划必须编译为状态、进展、待办和自动关联',
);
check(newPlan.accepted.map(operation => operation.key).join(',')
  === 'event-delta-1-state,event-delta-1-progress-1,event-delta-1-todo-1,event-delta-1-link-1',
'编译操作键必须稳定且可按事件增量归组');

const changedDate = prepareAssistantActions({
  operations: [], eventDeltas: [delta({
    evidence: ['改到20号还'],
    state: { action: 'replace', changeType: 'plan', value: '下一笔还款改到10月20日' },
    progress: [{ type: 'correction', content: '下一笔还款日期由10月11日改为10月20日' }],
    todos: [{
      action: 'update', todoId: 'todo-repay', dateStatus: 'resolved',
      dateText: '20号', dueDate: '2026-10-20', timePrecision: 'date',
    }],
  })], actionContext, currentMessage: '改到20号还', recentEvidence: [], referenceAt,
});
check(changedDate.rejected.length === 0, '已有待办改期应通过');
check(changedDate.accepted.some(operation => operation.type === 'update_todo'), '改期必须更新原待办');
check(!changedDate.accepted.some(operation => operation.type === 'create_todo'), '改期不得新建重复待办');
check(changedDate.accepted.some(operation => operation.type === 'link_todo_event'), '改期后应确保事件关系');

const completed = prepareAssistantActions({
  operations: [], eventDeltas: [delta({
    evidence: ['今天已经还了'],
    state: { action: 'replace', changeType: 'result', value: '本期还款已经完成' },
    progress: [{ type: 'result', content: '完成本期还款' }],
    todos: [{ action: 'complete', todoId: 'todo-repay' }],
  })], actionContext, currentMessage: '今天已经还了', recentEvidence: [], referenceAt,
});
check(completed.accepted.some(operation => operation.type === 'complete_todo'), '完成表达应完成唯一匹配待办');

const factOnly = prepareAssistantActions({
  operations: [], eventDeltas: [delta({
    evidence: ['补充一下，银行上周确认过资格'],
    state: { action: 'keep' },
    progress: [{ type: 'fact', content: '银行上周确认了提前还款资格' }],
    todos: [],
  })], actionContext,
  currentMessage: '补充一下，银行上周确认过资格', recentEvidence: [], referenceAt,
});
check(factOnly.accepted.length === 1 && factOnly.accepted[0].type === 'append_event_update',
  '重要历史事实可以只追加进展');

const duplicateTodo = prepareAssistantActions({
  operations: [], eventDeltas: [delta({
    evidence: ['每月正常还款'],
    state: { action: 'keep' },
    progress: [{ type: 'decision', content: '继续按月正常还款' }],
    todos: [{ action: 'create', todoRef: 'todo_1', text: '每月正常还款', dateStatus: 'absent' }],
  })], actionContext, currentMessage: '每月正常还款', recentEvidence: [], referenceAt,
});
check(duplicateTodo.accepted.length === 0, '与相关待办重复时不得新建');
check(duplicateTodo.rejected.some(item => item.reason === 'todo_should_update_existing'),
  '重复行动必须要求模型更新已有待办');

const mixedOperations = prepareAssistantActions({
  operations: [{
    key: 'old-state', type: 'update_event', eventId: 'event-loan', currentState: '旧式散列更新',
  }],
  eventDeltas: [delta()], actionContext, currentMessage: '下个月11号再还10万',
  recentEvidence: [], referenceAt,
});
check(!mixedOperations.accepted.some(operation => operation.key === 'old-state'),
  '存在事件增量时不得混入旧式事件操作');
check(mixedOperations.rejected.some(item => item.reason === 'mixed_event_operations'),
  '混合协议必须留下可观测拒绝原因');

for (const [label, badDelta, message, expectedReason] of [
  ['证据不在本轮原话', delta(), '换个话题', 'evidence_not_in_message'],
  ['状态变化缺少进展', delta({ progress: [], todos: [] }), '下个月11号再还10万', 'inconsistent_delta'],
  ['待办变化缺少进展', delta({ state: { action: 'keep' }, progress: [] }), '下个月11号再还10万', 'inconsistent_delta'],
  ['重复进展', delta({
    evidence: ['还是已提前还款30万'],
    state: { action: 'keep' }, progress: [{ type: 'fact', content: '已提前还款30万' }], todos: [],
  }), '还是已提前还款30万', 'compiled_operation_rejected'],
] as const) {
  const result = prepareAssistantActions({
    operations: [], eventDeltas: [badDelta], actionContext,
    currentMessage: message, recentEvidence: [], referenceAt,
  });
  check(result.accepted.length === 0, `${label}时整组不得部分提交`);
  check(result.rejected.some(item => item.reason === expectedReason), `${label}应记录明确拒绝原因`);
}

const ambiguousContext: AssistantActionContext = {
  ...actionContext,
  explicitEventId: null,
  events: [
    { ...actionContext.events[0], id: 'event-a', score: 0.9 },
    { ...actionContext.events[0], id: 'event-b', title: '商业贷款还款', score: 0.8 },
  ],
};
const ambiguousResult = prepareAssistantActions({
  operations: [], eventDeltas: [delta({ target: { action: 'update_existing', eventId: 'event-a' } })],
  actionContext: ambiguousContext, currentMessage: '下个月11号再还10万',
  recentEvidence: [], referenceAt,
});
check(ambiguousResult.accepted.length === 4,
  '精确事件 ID 已进入本轮可读上下文后，本地不得用相似度再次否决整组增量');

const recentTurnEvidence = prepareAssistantActions({
  operations: [],
  eventDeltas: [delta({
    evidence: ['十一出行就是这个', '对，10月1日10:39，齐齐哈尔南到哈尔滨'],
    target: { action: 'update_existing', eventId: 'event-loan' },
    state: { action: 'keep' },
    progress: [{ type: 'fact', content: '确认10月1日10:39齐齐哈尔南到哈尔滨' }],
    todos: [],
  })],
  actionContext,
  currentMessage: '对，10月1日10:39，齐齐哈尔南到哈尔滨',
  recentEvidence: ['十一出行就是这个'],
  referenceAt,
});
check(recentTurnEvidence.accepted.length === 1,
  '连续对话中的证据可以来自当前消息和最近用户原话，不能只看单条短回复');

const genericStillWorks = prepareAssistantActions({
  operations: [{
    key: 'standalone-todo', type: 'create_todo', todoRef: 'todo_1', text: '明天买牛奶',
    dateStatus: 'resolved', dateText: '明天', dueDate: '2026-09-16', timePrecision: 'date',
  }],
  eventDeltas: [], actionContext, currentMessage: '明天买牛奶', recentEvidence: [], referenceAt,
});
check(genericStillWorks.accepted.length === 1, '与事件无关的通用操作必须保持兼容');

console.log('assistant event delta tests passed');
