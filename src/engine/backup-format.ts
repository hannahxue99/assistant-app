import type {
  BackupEnvelope,
  BackupPayload,
  Entry,
  Profile,
  TopicPreference,
} from '../types';

const FORMAT = 'assistant-app-export-v2' as const;
const SCHEMA_VERSION = 2 as const;
const CAPSULE_START = '<!-- ASSISTANT_APP_EXPORT_V2\n';
const CAPSULE_END = '\nASSISTANT_APP_EXPORT_END -->';

export type BackupFormatErrorCode =
  | 'LEGACY_OR_UNKNOWN'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_DATA';

export class BackupFormatError extends Error {
  constructor(
    public readonly code: BackupFormatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

function invalid(message: string): never {
  throw new BackupFormatError('INVALID_DATA', message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableTimestamp(value: unknown): value is number | null {
  return value === null || isFiniteTimestamp(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateEntry(value: unknown, index: number): Entry {
  if (!isObject(value)) invalid(`第 ${index + 1} 条记录不是对象`);
  const kind = value.kind;
  const parseStatus = value.parseStatus;
  const parseSource = value.parseSource;
  const source = value.source;
  if (typeof value.id !== 'string' || !value.id) invalid(`第 ${index + 1} 条记录缺少 ID`);
  if (typeof value.rawText !== 'string') invalid(`第 ${index + 1} 条记录原文无效`);
  if (!['task', 'idea', 'info'].includes(String(kind))) invalid(`第 ${index + 1} 条记录类型无效`);
  if (typeof value.summary !== 'string') invalid(`第 ${index + 1} 条记录标题无效`);
  if (!isNullableTimestamp(value.dueAt) || !isNullableTimestamp(value.remindAt)) {
    invalid(`第 ${index + 1} 条记录时间无效`);
  }
  if (value.topic !== null && typeof value.topic !== 'string') invalid(`第 ${index + 1} 条记录主题无效`);
  if (!isStringArray(value.tags) || !isStringArray(value.persons)) invalid(`第 ${index + 1} 条记录数组字段无效`);
  if (!['pending', 'ok', 'failed', 'manual'].includes(String(parseStatus))) {
    invalid(`第 ${index + 1} 条记录理解状态无效`);
  }
  if (parseSource !== null && !['rule', 'llm', 'manual'].includes(String(parseSource))) {
    invalid(`第 ${index + 1} 条记录理解来源无效`);
  }
  if (value.correctedFrom !== null && typeof value.correctedFrom !== 'string') {
    invalid(`第 ${index + 1} 条记录纠正快照无效`);
  }
  if (!isFiniteTimestamp(value.createdAt)
    || !isFiniteTimestamp(value.updatedAt)
    || !isFiniteTimestamp(value.revisionAt)) {
    invalid(`第 ${index + 1} 条记录版本时间无效`);
  }
  if (value.done !== 0 && value.done !== 1) invalid(`第 ${index + 1} 条记录完成状态无效`);
  if (!isNullableTimestamp(value.doneAt)) invalid(`第 ${index + 1} 条记录完成时间无效`);
  if (source !== 'text' && source !== 'voice') invalid(`第 ${index + 1} 条记录输入来源无效`);
  return value as unknown as Entry;
}

function validateProfile(value: unknown): Profile {
  if (!isObject(value)
    || typeof value.name !== 'string'
    || !isStringArray(value.goals)
    || !isStringArray(value.avoid)
    || typeof value.notifyMorning !== 'boolean'
    || typeof value.notifyEvening !== 'boolean') {
    invalid('用户画像数据无效');
  }
  return value as unknown as Profile;
}

function validateTopicPreference(value: unknown, index: number): TopicPreference {
  if (!isObject(value)
    || typeof value.topic !== 'string'
    || !value.topic.trim()
    || !isFiniteTimestamp(value.pinnedAt)) {
    invalid(`第 ${index + 1} 个主题偏好无效`);
  }
  return value as unknown as TopicPreference;
}

function validateEnvelope(value: unknown): BackupEnvelope {
  if (!isObject(value)) invalid('备份数据不是对象');
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new BackupFormatError('UNSUPPORTED_VERSION', '备份文件版本不受支持');
  }
  if (value.format !== FORMAT) invalid('备份格式标识无效');
  if (!isFiniteTimestamp(value.exportedAt)) invalid('备份时间无效');
  if (typeof value.entryCount !== 'number' || !Number.isInteger(value.entryCount) || value.entryCount < 0) {
    invalid('备份记录数量无效');
  }
  if (!isObject(value.payload) || !Array.isArray(value.payload.entries)
    || !Array.isArray(value.payload.topicPreferences)) {
    invalid('备份内容缺少必要字段');
  }

  const entries = value.payload.entries.map(validateEntry);
  if (entries.length !== value.entryCount) invalid('备份记录数量不一致');
  const ids = new Set<string>();
  for (const item of entries) {
    if (ids.has(item.id)) invalid(`备份中存在重复记录 ID：${item.id}`);
    ids.add(item.id);
  }

  const topicPreferences = value.payload.topicPreferences.map(validateTopicPreference);
  const topics = new Set<string>();
  for (const preference of topicPreferences) {
    if (topics.has(preference.topic)) invalid(`备份中存在重复主题偏好：${preference.topic}`);
    topics.add(preference.topic);
  }

  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: value.exportedAt,
    entryCount: value.entryCount,
    payload: {
      entries,
      profile: validateProfile(value.payload.profile),
      topicPreferences,
    },
  };
}

/** 在可读 Markdown 末尾追加 App 专用数据胶囊。 */
export function buildImportableMarkdown(
  readableMarkdown: string,
  payload: BackupPayload,
  exportedAt = Date.now(),
): string {
  const envelope: BackupEnvelope = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    entryCount: payload.entries.length,
    payload,
  };
  // HTML 注释不能包含连续 "--"；转为合法 JSON Unicode 转义，解析后内容不变。
  const json = JSON.stringify(envelope).replace(/--/g, '\\u002d\\u002d');
  return `${readableMarkdown.trimEnd()}\n\n${CAPSULE_START}${json}${CAPSULE_END}\n`;
}

/** 只读取 V2 数据胶囊，不从展示文案猜测结构化字段。 */
export function parseImportableMarkdown(markdown: string): BackupEnvelope {
  const start = markdown.lastIndexOf(CAPSULE_START);
  if (start < 0) {
    throw new BackupFormatError('LEGACY_OR_UNKNOWN', '没有找到新版 App 的完整恢复数据');
  }
  const jsonStart = start + CAPSULE_START.length;
  const end = markdown.indexOf(CAPSULE_END, jsonStart);
  if (end < 0) invalid('备份数据胶囊不完整');

  let decoded: unknown;
  try {
    decoded = JSON.parse(markdown.slice(jsonStart, end));
  } catch {
    invalid('备份 JSON 已损坏');
  }
  return validateEnvelope(decoded);
}
