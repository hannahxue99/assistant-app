import type { AssistantStageDurations } from '../assistant/runtime-state';
import type { ConversationSegment } from '../assistant/types';
import type {
  AssistantEvent,
  AssistantEventUpdate,
  AssistantObjectRelation,
  AssistantOperation,
} from '../assistant/action-types';
import type { AssistantMemory, AssistantMemorySource } from '../assistant/memory-types';
import type { Entry, Profile, TopicPreference } from '../types';
import {
  BackupFormatError,
  buildImportableMarkdown,
  parseImportableMarkdown,
} from './backup-format';

const FORMAT = 'assistant-app-export-v3' as const;
const SCHEMA_VERSION = 3 as const;
const CAPSULE_START = '<!-- ASSISTANT_APP_EXPORT_V3\n';
const CAPSULE_END = '\nASSISTANT_APP_EXPORT_END -->';

export type BackupV3FormatErrorCode = 'LEGACY_OR_UNKNOWN' | 'UNSUPPORTED_VERSION' | 'INVALID_DATA';

export class BackupV3FormatError extends Error {
  constructor(public readonly code: BackupV3FormatErrorCode, message: string) {
    super(message);
    this.name = 'BackupV3FormatError';
  }
}

export interface BackupAssistantRequest {
  id: string;
  userMessageId: string;
  status: 'succeeded' | 'failed';
  errorCode: string | null;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BackupAssistantMessage {
  id: string;
  requestId: string;
  role: 'user' | 'assistant';
  content: string;
  source: 'text' | 'voice' | 'legacy' | 'contextual' | 'assistant';
  status: 'saved' | 'failed';
  segmentId: string;
  legacyEntryId: string | null;
  stageDurations: AssistantStageDurations;
  createdAt: number;
  updatedAt: number;
}

export interface BackupEventAlias {
  id: string;
  eventId: string;
  alias: string;
  createdAt: number;
}

export interface BackupPayloadV3 {
  entries: Entry[];
  profile: Profile;
  topicPreferences: TopicPreference[];
  conversationSegments: ConversationSegment[];
  assistantRequests: BackupAssistantRequest[];
  assistantMessages: BackupAssistantMessage[];
  events: AssistantEvent[];
  eventAliases: BackupEventAlias[];
  eventUpdates: AssistantEventUpdate[];
  objectRelations: AssistantObjectRelation[];
  operations: AssistantOperation[];
  memories: AssistantMemory[];
  memorySources: AssistantMemorySource[];
}

export type BackupV3ObjectKind = keyof BackupPayloadV3;

export interface BackupEnvelopeV3 {
  format: typeof FORMAT;
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: number;
  counts: Record<BackupV3ObjectKind, number>;
  payload: BackupPayloadV3;
}

const PAYLOAD_KEYS: BackupV3ObjectKind[] = [
  'entries', 'profile', 'topicPreferences', 'conversationSegments', 'assistantRequests',
  'assistantMessages', 'events', 'eventAliases', 'eventUpdates', 'objectRelations',
  'operations', 'memories', 'memorySources',
];

const OPERATION_TYPES = [
  'create_todo', 'update_todo', 'complete_todo', 'delete_todo', 'create_event', 'update_event',
  'append_event_update', 'rename_event', 'pin_event', 'delete_event', 'link_todo_event',
  'unlink_todo_event', 'delete_event_update', 'create_memory', 'activate_memory',
  'supersede_memory', 'forget_memory',
] as const;

const OPERATION_OBJECT_TYPES = ['todo', 'event', 'event_update', 'relation', 'memory'] as const;
const RELATION_OBJECT_TYPES = ['message', 'todo', 'event', 'event_update', 'relation', 'memory'] as const;

function invalid(message: string): never {
  throw new BackupV3FormatError('INVALID_DATA', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) invalid(`${label}无效`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label, true);
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${label}时间无效`);
  return value;
}

function nullableTimestamp(value: unknown, label: string): number | null {
  return value === null ? null : timestamp(value, label);
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) invalid(`${label}无效`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${label}无效`);
  return value as T;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label}列表无效`);
  return value;
}

function uniqueById<T extends { id: string }>(values: T[], label: string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const value of values) {
    if (byId.has(value.id)) invalid(`${label}存在重复 ID：${value.id}`);
    byId.set(value.id, value);
  }
  return byId;
}

function validateBasePayload(value: Record<string, unknown>, exportedAt: number) {
  try {
    return parseImportableMarkdown(buildImportableMarkdown('', {
      entries: arrayValue(value.entries, '记录') as Entry[],
      profile: value.profile as Profile,
      topicPreferences: arrayValue(value.topicPreferences, '主题偏好') as TopicPreference[],
      memories: arrayValue(value.memories, '长期记忆') as AssistantMemory[],
      memorySources: arrayValue(value.memorySources, '长期记忆来源') as AssistantMemorySource[],
    }, exportedAt)).payload;
  } catch (error) {
    if (error instanceof BackupFormatError) invalid(error.message);
    throw error;
  }
}

function validateSegment(value: unknown, index: number): ConversationSegment {
  if (!isObject(value)) invalid(`第 ${index + 1} 个对话分段不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 个对话分段 ID`),
    summary: stringValue(value.summary, `第 ${index + 1} 个对话分段摘要`, true),
    status: enumValue(value.status, ['current', 'closed'], `第 ${index + 1} 个对话分段状态`),
    startedAt: timestamp(value.startedAt, `第 ${index + 1} 个对话分段开始`),
    endedAt: nullableTimestamp(value.endedAt, `第 ${index + 1} 个对话分段结束`),
    updatedAt: timestamp(value.updatedAt, `第 ${index + 1} 个对话分段更新`),
  };
}

function validateRequest(value: unknown, index: number): BackupAssistantRequest {
  if (!isObject(value)) invalid(`第 ${index + 1} 个请求不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 个请求 ID`),
    userMessageId: stringValue(value.userMessageId, `第 ${index + 1} 个请求用户消息`),
    status: enumValue(value.status, ['succeeded', 'failed'], `第 ${index + 1} 个请求状态`),
    errorCode: nullableString(value.errorCode, `第 ${index + 1} 个请求错误码`),
    attemptCount: integer(value.attemptCount, `第 ${index + 1} 个请求尝试次数`, 1),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 个请求创建`),
    updatedAt: timestamp(value.updatedAt, `第 ${index + 1} 个请求更新`),
  };
}

function validateStageDurations(value: unknown, index: number): AssistantStageDurations {
  if (!isObject(value)) invalid(`第 ${index + 1} 条消息阶段耗时无效`);
  const result: AssistantStageDurations = {};
  for (const key of ['readingMs', 'thinkingMs', 'updatingMs'] as const) {
    const duration = value[key];
    if (duration === undefined) continue;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      invalid(`第 ${index + 1} 条消息阶段耗时无效`);
    }
    result[key] = duration;
  }
  if (Object.keys(value).some(key => !['readingMs', 'thinkingMs', 'updatingMs'].includes(key))) {
    invalid(`第 ${index + 1} 条消息包含未知阶段耗时`);
  }
  return result;
}

function validateMessage(value: unknown, index: number): BackupAssistantMessage {
  if (!isObject(value)) invalid(`第 ${index + 1} 条消息不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 条消息 ID`),
    requestId: stringValue(value.requestId, `第 ${index + 1} 条消息请求`),
    role: enumValue(value.role, ['user', 'assistant'], `第 ${index + 1} 条消息角色`),
    content: stringValue(value.content, `第 ${index + 1} 条消息正文`, true),
    source: enumValue(value.source, ['text', 'voice', 'legacy', 'contextual', 'assistant'], `第 ${index + 1} 条消息来源`),
    status: enumValue(value.status, ['saved', 'failed'], `第 ${index + 1} 条消息状态`),
    segmentId: stringValue(value.segmentId, `第 ${index + 1} 条消息分段`),
    legacyEntryId: nullableString(value.legacyEntryId, `第 ${index + 1} 条消息旧记录`),
    stageDurations: validateStageDurations(value.stageDurations, index),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 条消息创建`),
    updatedAt: timestamp(value.updatedAt, `第 ${index + 1} 条消息更新`),
  };
}

function validateEvent(value: unknown, index: number): AssistantEvent {
  if (!isObject(value)) invalid(`第 ${index + 1} 个事件不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 个事件 ID`),
    title: stringValue(value.title, `第 ${index + 1} 个事件标题`),
    currentState: stringValue(value.currentState, `第 ${index + 1} 个事件状态正文`, true),
    status: enumValue(value.status, ['active', 'closed'], `第 ${index + 1} 个事件状态`),
    pinnedAt: nullableTimestamp(value.pinnedAt, `第 ${index + 1} 个事件置顶`),
    revision: integer(value.revision, `第 ${index + 1} 个事件版本`, 1),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 个事件创建`),
    updatedAt: timestamp(value.updatedAt, `第 ${index + 1} 个事件更新`),
  };
}

function validateEventAlias(value: unknown, index: number): BackupEventAlias {
  if (!isObject(value)) invalid(`第 ${index + 1} 个事件别名不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 个事件别名 ID`),
    eventId: stringValue(value.eventId, `第 ${index + 1} 个事件别名事件`),
    alias: stringValue(value.alias, `第 ${index + 1} 个事件别名`),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 个事件别名创建`),
  };
}

function validateEventUpdate(value: unknown, index: number): AssistantEventUpdate {
  if (!isObject(value)) invalid(`第 ${index + 1} 条事件进展不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 条事件进展 ID`),
    eventId: stringValue(value.eventId, `第 ${index + 1} 条事件进展事件`),
    content: stringValue(value.content, `第 ${index + 1} 条事件进展正文`),
    occurredAt: timestamp(value.occurredAt, `第 ${index + 1} 条事件进展发生`),
    sourceMessageId: nullableString(value.sourceMessageId, `第 ${index + 1} 条事件进展来源消息`),
    stableKey: stringValue(value.stableKey, `第 ${index + 1} 条事件进展稳定键`),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 条事件进展创建`),
    undoneAt: nullableTimestamp(value.undoneAt, `第 ${index + 1} 条事件进展撤销`),
  };
}

function validateRelation(value: unknown, index: number): AssistantObjectRelation {
  if (!isObject(value)) invalid(`第 ${index + 1} 条对象关系不是对象`);
  return {
    id: stringValue(value.id, `第 ${index + 1} 条对象关系 ID`),
    fromType: enumValue(value.fromType, RELATION_OBJECT_TYPES, `第 ${index + 1} 条对象关系起点类型`),
    fromId: stringValue(value.fromId, `第 ${index + 1} 条对象关系起点`),
    relationType: enumValue(value.relationType, ['source', 'belongs_to', 'follows', 'related'], `第 ${index + 1} 条对象关系类型`),
    toType: enumValue(value.toType, RELATION_OBJECT_TYPES, `第 ${index + 1} 条对象关系终点类型`),
    toId: stringValue(value.toId, `第 ${index + 1} 条对象关系终点`),
    sourceMessageId: nullableString(value.sourceMessageId, `第 ${index + 1} 条对象关系来源消息`),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 条对象关系创建`),
    undoneAt: nullableTimestamp(value.undoneAt, `第 ${index + 1} 条对象关系撤销`),
  };
}

function validateOperation(value: unknown, index: number): AssistantOperation {
  if (!isObject(value)) invalid(`第 ${index + 1} 条操作不是对象`);
  const beforeSnapshot = nullableString(value.beforeSnapshot, `第 ${index + 1} 条操作前快照`);
  const afterSnapshot = stringValue(value.afterSnapshot, `第 ${index + 1} 条操作后快照`);
  try {
    if (beforeSnapshot !== null) JSON.parse(beforeSnapshot);
    JSON.parse(afterSnapshot);
  } catch {
    invalid(`第 ${index + 1} 条操作快照不是合法 JSON`);
  }
  return {
    id: stringValue(value.id, `第 ${index + 1} 条操作 ID`),
    requestId: stringValue(value.requestId, `第 ${index + 1} 条操作请求`),
    operationKey: stringValue(value.operationKey, `第 ${index + 1} 条操作键`),
    operationType: enumValue(value.operationType, OPERATION_TYPES, `第 ${index + 1} 条操作类型`),
    objectType: enumValue(value.objectType, OPERATION_OBJECT_TYPES, `第 ${index + 1} 条操作对象类型`),
    objectId: stringValue(value.objectId, `第 ${index + 1} 条操作对象`),
    beforeSnapshot,
    afterSnapshot,
    receiptSummary: stringValue(value.receiptSummary, `第 ${index + 1} 条操作回执`),
    status: enumValue(value.status, ['committed', 'undone'], `第 ${index + 1} 条操作状态`),
    sequence: integer(value.sequence, `第 ${index + 1} 条操作序号`),
    createdAt: timestamp(value.createdAt, `第 ${index + 1} 条操作创建`),
    undoneAt: nullableTimestamp(value.undoneAt, `第 ${index + 1} 条操作撤销`),
  };
}

function assertRelationTarget(
  type: AssistantObjectRelation['fromType'],
  id: string,
  sets: Record<AssistantObjectRelation['fromType'], Set<string>>,
  label: string,
) {
  if (!sets[type].has(id)) invalid(`${label}指向不存在的 ${type}：${id}`);
}

function validateMemoryCycles(memories: AssistantMemory[]) {
  const next = new Map(memories.map(memory => [memory.id, memory.supersededById]));
  for (const memory of memories) {
    const seen = new Set<string>();
    let current: string | null = memory.id;
    while (current !== null) {
      if (seen.has(current)) invalid(`长期记忆替代关系存在循环：${memory.id}`);
      seen.add(current);
      current = next.get(current) ?? null;
    }
  }
}

function countsForPayload(payload: BackupPayloadV3): Record<BackupV3ObjectKind, number> {
  return {
    entries: payload.entries.length,
    profile: 1,
    topicPreferences: payload.topicPreferences.length,
    conversationSegments: payload.conversationSegments.length,
    assistantRequests: payload.assistantRequests.length,
    assistantMessages: payload.assistantMessages.length,
    events: payload.events.length,
    eventAliases: payload.eventAliases.length,
    eventUpdates: payload.eventUpdates.length,
    objectRelations: payload.objectRelations.length,
    operations: payload.operations.length,
    memories: payload.memories.length,
    memorySources: payload.memorySources.length,
  };
}

function validateEnvelope(value: unknown): BackupEnvelopeV3 {
  if (!isObject(value)) invalid('V3 备份数据不是对象');
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new BackupV3FormatError('UNSUPPORTED_VERSION', '备份文件版本高于当前 App 能力');
  }
  if (value.format !== FORMAT) invalid('V3 备份格式标识无效');
  const exportedAt = timestamp(value.exportedAt, 'V3 备份');
  if (!isObject(value.payload)) invalid('V3 备份缺少内容');

  const base = validateBasePayload(value.payload, exportedAt);
  const payload: BackupPayloadV3 = {
    entries: base.entries,
    profile: base.profile,
    topicPreferences: base.topicPreferences,
    conversationSegments: arrayValue(value.payload.conversationSegments, '对话分段').map(validateSegment),
    assistantRequests: arrayValue(value.payload.assistantRequests, '助手请求').map(validateRequest),
    assistantMessages: arrayValue(value.payload.assistantMessages, '助手消息').map(validateMessage),
    events: arrayValue(value.payload.events, '事件').map(validateEvent),
    eventAliases: arrayValue(value.payload.eventAliases, '事件别名').map(validateEventAlias),
    eventUpdates: arrayValue(value.payload.eventUpdates, '事件进展').map(validateEventUpdate),
    objectRelations: arrayValue(value.payload.objectRelations, '对象关系').map(validateRelation),
    operations: arrayValue(value.payload.operations, '操作').map(validateOperation),
    memories: base.memories ?? [],
    memorySources: base.memorySources ?? [],
  };

  const entries = uniqueById(payload.entries, '记录');
  const segments = uniqueById(payload.conversationSegments, '对话分段');
  const requests = uniqueById(payload.assistantRequests, '助手请求');
  const messages = uniqueById(payload.assistantMessages, '助手消息');
  const events = uniqueById(payload.events, '事件');
  uniqueById(payload.eventAliases, '事件别名');
  const updates = uniqueById(payload.eventUpdates, '事件进展');
  const relations = uniqueById(payload.objectRelations, '对象关系');
  uniqueById(payload.operations, '操作');
  const memories = uniqueById(payload.memories, '长期记忆');
  uniqueById(payload.memorySources, '长期记忆来源');

  if (payload.conversationSegments.filter(segment => segment.status === 'current').length > 1) {
    invalid('备份中存在多个当前对话分段');
  }
  const requestRoles = new Set<string>();
  for (const message of payload.assistantMessages) {
    if (!segments.has(message.segmentId)) invalid(`消息指向不存在的分段：${message.segmentId}`);
    if (!requests.has(message.requestId)) invalid(`消息指向不存在的请求：${message.requestId}`);
    const roleKey = `${message.requestId}:${message.role}`;
    if (requestRoles.has(roleKey)) invalid(`请求包含重复角色消息：${roleKey}`);
    requestRoles.add(roleKey);
  }
  for (const request of payload.assistantRequests) {
    const userMessage = messages.get(request.userMessageId);
    if (!userMessage || userMessage.role !== 'user' || userMessage.requestId !== request.id) {
      invalid(`请求的用户消息不完整：${request.id}`);
    }
  }
  for (const alias of payload.eventAliases) {
    if (!events.has(alias.eventId)) invalid(`事件别名指向不存在的事件：${alias.eventId}`);
  }
  const stableKeys = new Set<string>();
  for (const update of payload.eventUpdates) {
    if (!events.has(update.eventId)) invalid(`事件进展指向不存在的事件：${update.eventId}`);
    if (update.sourceMessageId && !messages.has(update.sourceMessageId)) invalid(`事件进展来源消息不存在：${update.sourceMessageId}`);
    if (stableKeys.has(update.stableKey)) invalid(`事件进展稳定键重复：${update.stableKey}`);
    stableKeys.add(update.stableKey);
  }
  validateMemoryCycles(payload.memories);
  for (const memory of payload.memories) {
    if (memory.supersededById && !memories.has(memory.supersededById)) invalid(`长期记忆替代对象不存在：${memory.supersededById}`);
  }
  for (const source of payload.memorySources) {
    if (source.sourceMessageId && !messages.has(source.sourceMessageId)) invalid(`长期记忆来源消息不存在：${source.sourceMessageId}`);
  }

  const targetSets: Record<AssistantObjectRelation['fromType'], Set<string>> = {
    message: new Set(messages.keys()),
    todo: new Set([...entries.values()].filter(entry => entry.kind === 'task').map(entry => entry.id)),
    event: new Set(events.keys()),
    event_update: new Set(updates.keys()),
    relation: new Set(relations.keys()),
    memory: new Set(memories.keys()),
  };
  for (const relation of payload.objectRelations) {
    if (relation.undoneAt === null) {
      assertRelationTarget(relation.fromType, relation.fromId, targetSets, `关系 ${relation.id} 起点`);
      assertRelationTarget(relation.toType, relation.toId, targetSets, `关系 ${relation.id} 终点`);
    }
    if (relation.sourceMessageId && !messages.has(relation.sourceMessageId)) invalid(`关系来源消息不存在：${relation.sourceMessageId}`);
  }

  const operationKeys = new Set<string>();
  const operationSequences = new Set<string>();
  for (const operation of payload.operations) {
    if (!requests.has(operation.requestId)) invalid(`操作指向不存在的请求：${operation.requestId}`);
    const key = `${operation.requestId}:${operation.operationKey}`;
    const sequence = `${operation.requestId}:${operation.sequence}`;
    if (operationKeys.has(key)) invalid(`请求包含重复操作键：${key}`);
    if (operationSequences.has(sequence)) invalid(`请求包含重复操作序号：${sequence}`);
    operationKeys.add(key);
    operationSequences.add(sequence);
    if (operation.operationType !== 'delete_todo') {
      assertRelationTarget(operation.objectType, operation.objectId, targetSets, `操作 ${operation.id}`);
    } else {
      let after: unknown;
      try {
        after = JSON.parse(operation.afterSnapshot);
      } catch {
        invalid(`操作 ${operation.id} 的删除快照无效`);
      }
      if (!isObject(after) || after.deleted !== true || after.todoId !== operation.objectId) {
        invalid(`操作 ${operation.id} 的删除快照无效`);
      }
    }
  }

  if (!isObject(value.counts)) invalid('V3 备份缺少数量摘要');
  const expectedCounts = countsForPayload(payload);
  for (const key of PAYLOAD_KEYS) {
    const count = integer(value.counts[key], `${key} 数量`);
    if (count !== expectedCounts[key]) invalid(`${key} 数量不一致`);
  }

  return { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, counts: expectedCounts, payload };
}

export function buildBackupV3Markdown(
  readableMarkdown: string,
  payload: BackupPayloadV3,
  exportedAt = Date.now(),
): string {
  const envelope = validateEnvelope({
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    counts: countsForPayload(payload),
    payload,
  });
  const json = JSON.stringify(envelope).replace(/--/g, '\\u002d\\u002d');
  return `${readableMarkdown.trimEnd()}\n\n${CAPSULE_START}${json}${CAPSULE_END}\n`;
}

export function parseBackupV3Markdown(markdown: string): BackupEnvelopeV3 {
  const start = markdown.lastIndexOf(CAPSULE_START);
  if (start < 0) throw new BackupV3FormatError('LEGACY_OR_UNKNOWN', '没有找到 V3 完整恢复数据');
  const jsonStart = start + CAPSULE_START.length;
  const end = markdown.indexOf(CAPSULE_END, jsonStart);
  if (end < 0) invalid('V3 备份数据胶囊不完整');
  let decoded: unknown;
  try {
    decoded = JSON.parse(markdown.slice(jsonStart, end));
  } catch {
    invalid('V3 备份 JSON 已损坏');
  }
  return validateEnvelope(decoded);
}
