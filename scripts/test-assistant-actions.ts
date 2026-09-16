import {
  classifyEventCandidates,
  rankEventCandidates,
  shouldAdmitNewEvent,
} from '../src/assistant/action-context';
import { validateAssistantActions } from '../src/assistant/action-validator';
import type { AssistantActionContext, AssistantEventCandidate } from '../src/assistant/action-types';
import { projectModelDate } from '../src/assistant/model-date';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const now = new Date('2026-09-15T10:00:00+08:00').getTime();

const leapDate = projectModelDate({
  dateStatus: 'resolved', dateText: '2028年2月29号', dueDate: '2028-02-29', timePrecision: 'date',
});
check(leapDate.ok && new Date(leapDate.value.dueAt!).getDate() === 29, '模型给出的闰日应通过日历校验');
check(!projectModelDate({
  dateStatus: 'resolved', dateText: '2027年2月29号', dueDate: '2027-02-29', timePrecision: 'date',
}).ok, '非闰年2月29日必须拒绝');
const explicitTime = projectModelDate({
  dateStatus: 'resolved', dateText: '下个月10号下午3点', dueDate: '2026-10-10', dueTime: '15:00', timePrecision: 'dateTime',
});
check(explicitTime.ok && new Date(explicitTime.value.dueAt!).getHours() === 15, '明确时刻应机械投影为本地时间');
check(projectModelDate({ dateStatus: 'absent' }).ok, '模型判断无日期时应允许隐藏待办');
check(projectModelDate({ dateStatus: 'ambiguous', dateText: '下个月找一天' }).ok,
  '模型判断日期含糊时应允许隐藏待办');

check(!shouldAdmitNewEvent('明天买一瓶牛奶', []), '一次性行动不应进入事件');
check(shouldAdmitNewEvent('接下来持续跟进房贷还款进度', []), '明确持续跟进应允许建立事件');
check(shouldAdmitNewEvent('今天又看了一套房', ['上周开始看房', '昨天联系了中介']),
  '同一主线多次出现状态变化时可升级为事件');

function eventCandidate(overrides: Partial<AssistantEventCandidate> = {}): AssistantEventCandidate {
  return {
    id: 'event-house',
    title: '换房计划',
    currentState: '正在看房',
    aliases: [],
    linkedTodoTexts: [],
    revision: 1,
    updatedAt: now,
    score: 0,
    ...overrides,
  };
}

const ranked = rankEventCandidates('今天看了第二套房', [
  eventCandidate(),
  eventCandidate({ id: 'event-swim', title: '学游泳', currentState: '已报名第一节课' }),
]);
check(ranked[0].id === 'event-house', '文本明显命中时应选中正确事件');
check(classifyEventCandidates(ranked).kind === 'single', '只有一个强候选时应允许自动更新');

const ambiguous = classifyEventCandidates([
  eventCandidate({ id: 'event-house-a', score: 0.82 }),
  eventCandidate({ id: 'event-house-b', title: '父母换房', score: 0.78 }),
]);
check(ambiguous.kind === 'ambiguous', '两个相近强候选必须要求澄清');

const ambiguousCreate = validateAssistantActions({
  operations: [{
    key: 'event', type: 'create_event', eventRef: 'event_1',
    title: '新的房子事件', currentState: '今天有进展',
  }],
  actionContext: {
    events: [
      eventCandidate({ id: 'event-house-a', score: 0.82 }),
      eventCandidate({ id: 'event-house-b', title: '父母换房', score: 0.78 }),
    ],
    todos: [], explicitEventId: null, segmentEventId: null,
  },
  currentMessage: '房子后续要持续跟进',
  recentEvidence: [],
  referenceAt: now,
});
check(ambiguousCreate.accepted.length === 0 && ambiguousCreate.rejected[0]?.reason === 'ambiguous_candidate',
  '已有事件候选歧义时不得绕过澄清新建重复事件');

const context: AssistantActionContext = {
  events: [eventCandidate()],
  todos: [{
    id: 'todo-photo', text: '整理照片', dueAt: null, revisionAt: 10, updatedAt: 10, score: 1,
  }],
  explicitEventId: null,
  segmentEventId: null,
};

const oneOff = validateAssistantActions({
  operations: [
    { key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '明天买牛奶', dateStatus: 'resolved', dateText: '明天', dueDate: '2026-09-16', timePrecision: 'date' },
    { key: 'event', type: 'create_event', eventRef: 'event_1', title: '买牛奶', currentState: '准备购买' },
  ],
  actionContext: context,
  currentMessage: '明天买牛奶',
  recentEvidence: [],
  referenceAt: now,
});
check(oneOff.accepted.some(operation => operation.type === 'create_todo'), '一次性行动应保留待办');
check(!oneOff.accepted.some(operation => operation.type === 'create_event'), '一次性行动应拒绝事件建议');

const explicitEvent = validateAssistantActions({
  operations: [
    { key: 'event', type: 'create_event', eventRef: 'event_1', title: '换房计划', currentState: '开始看房' },
    { key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '周六看第二套房', dateStatus: 'resolved', dateText: '周六', dueDate: '2026-09-19', timePrecision: 'date' },
    {
      key: 'link', type: 'link_todo_event',
      todo: { kind: 'local', ref: 'todo_1' }, event: { kind: 'local', ref: 'event_1' },
    },
  ],
  actionContext: context,
  currentMessage: '这个换房计划要持续跟进，周六看第二套房',
  recentEvidence: [],
  referenceAt: now,
});
check(explicitEvent.accepted.length === 3, '有效本地引用应按依赖顺序全部保留');

const invalidId = validateAssistantActions({
  operations: [{ key: 'done', type: 'complete_todo', todoId: 'todo-not-in-context' }],
  actionContext: context,
  currentMessage: '完成了',
  recentEvidence: [],
  referenceAt: now,
});
check(invalidId.accepted.length === 0 && invalidId.rejected[0]?.reason === 'candidate_not_allowed',
  '上下文外的对象 ID 必须拒绝');

const validDelete = validateAssistantActions({
  operations: [
    { key: 'delete-todo', type: 'delete_todo', todoId: 'todo-photo' },
    { key: 'delete-event', type: 'delete_event', eventId: 'event-house', linkedTodoPolicy: 'keep' },
  ],
  actionContext: context,
  currentMessage: '删掉整理照片，事件也删掉但保留待办',
  recentEvidence: [],
  referenceAt: now,
});
check(validDelete.accepted.length === 2, '上下文内待办与事件删除应通过校验');

const invalidDelete = validateAssistantActions({
  operations: [
    { key: 'delete-todo', type: 'delete_todo', todoId: 'todo-unknown' },
    { key: 'delete-event', type: 'delete_event', eventId: 'event-unknown', linkedTodoPolicy: 'delete' },
  ],
  actionContext: context,
  currentMessage: '删除',
  recentEvidence: [],
  referenceAt: now,
});
check(invalidDelete.accepted.length === 0 && invalidDelete.rejected.length === 2,
  '上下文外删除目标必须全部拒绝');

const duplicateEventText = validateAssistantActions({
  operations: [
    { key: 'state', type: 'update_event', eventId: 'event-house', currentState: '正在看房' },
    {
      key: 'progress', type: 'append_event_update',
      event: { kind: 'candidate', id: 'event-house' }, content: '正在看房',
    },
  ],
  actionContext: context,
  currentMessage: '还是正在看房',
  recentEvidence: [],
  referenceAt: now,
});
check(duplicateEventText.accepted.length === 0, '与当前状态相同的更新和进展不应重复写入');

const hiddenTodo = validateAssistantActions({
  operations: [{ key: 'todo', type: 'create_todo', todoRef: 'todo_1', text: '整理照片', dateStatus: 'absent' }],
  actionContext: context,
  currentMessage: '有空整理一下照片',
  recentEvidence: [],
  referenceAt: now,
});
check(hiddenTodo.accepted[0]?.type === 'create_todo' && hiddenTodo.accepted[0].dueAt === null,
  '无日期行动应保存为隐藏待办');

const datedFollowUp = validateAssistantActions({
  operations: [{ key: 'date', type: 'update_todo', todoId: 'todo-photo', dateStatus: 'resolved', dateText: '周六', dueDate: '2026-09-19', timePrecision: 'date' }],
  actionContext: context,
  currentMessage: '那就周六吧',
  recentEvidence: [],
  referenceAt: now,
});
check(datedFollowUp.accepted[0]?.type === 'update_todo' && datedFollowUp.accepted[0].dueAt !== null,
  '补充日期应更新同一个候选待办');
const ambiguousUpdate = validateAssistantActions({
  operations: [{
    key: 'date', type: 'update_todo', todoId: 'todo-photo',
    dateStatus: 'ambiguous', dateText: '下个月找一天',
  }],
  actionContext: context,
  currentMessage: '改到下个月找一天吧',
  recentEvidence: [],
  referenceAt: now,
});
check(ambiguousUpdate.rejected[0]?.reason === 'invalid_date_protocol', '含糊日期不得改写已有待办日期');

const nextMonthDate = validateAssistantActions({
  operations: [{
    key: 'repay', type: 'create_todo', todoRef: 'todo_1', text: '还款',
    dateStatus: 'resolved', dateText: '下个月10号', dueDate: '2026-10-10', timePrecision: 'date',
  }],
  actionContext: context,
  currentMessage: '下个月10号还',
  recentEvidence: [],
  referenceAt: now,
});
check(nextMonthDate.accepted[0]?.type === 'create_todo'
  && nextMonthDate.accepted[0].dueAt === new Date(2026, 9, 10, 9, 0, 0, 0).getTime(),
'模型解析的下个月日期应机械投影，不再解析日期原文');

const invalidCalendarDate = validateAssistantActions({
  operations: [{
    key: 'bad', type: 'create_todo', todoRef: 'todo_1', text: '无效日期',
    dateStatus: 'resolved', dateText: '2月30号', dueDate: '2026-02-30', timePrecision: 'date',
  }],
  actionContext: context,
  currentMessage: '2月30号处理',
  recentEvidence: [],
  referenceAt: now,
});
check(invalidCalendarDate.rejected[0]?.reason === 'invalid_calendar_date', '非法日历日期必须被本地格式校验拒绝');

const launchContext: AssistantActionContext = {
  ...context,
  explicitEventId: 'event-house',
};
const contextualUpdate = validateAssistantActions({
  operations: [{ key: 'state', type: 'update_event', eventId: 'event-house', currentState: '已看完第二套房' }],
  actionContext: launchContext,
  currentMessage: '今天看完第二套了',
  recentEvidence: [],
  referenceAt: now,
});
check(contextualUpdate.accepted.length === 1, '从事件详情进入时应允许更新该稳定事件 ID');

console.log('assistant action validation tests passed');
