import { stableLocalHash } from '../assistant/stable-id';
import type { Entry, EntryKind } from '../types';
import { inferTimePrecision } from './calendar-projection';

export interface LegacyBackupEnvelope {
  format: 'assistant-app-export-v1';
  exportedAt: number;
  entries: Entry[];
  duplicateCount: number;
}

export class LegacyBackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyBackupFormatError';
  }
}

type LegacyFingerprintEntry = Pick<
  Entry,
  'rawText' | 'kind' | 'summary' | 'dueAt' | 'topic' | 'tags' | 'createdAt' | 'done'
>;

export function legacyEntryFingerprint(entry: LegacyFingerprintEntry): string {
  return stableLocalHash(JSON.stringify({
    rawText: entry.rawText,
    kind: entry.kind,
    summary: entry.summary,
    dueAt: entry.dueAt,
    topic: entry.topic,
    tags: entry.tags,
    createdAt: entry.createdAt,
    done: entry.done,
  }));
}

const HEADER = /^##\s+(待办|想法|信息)(?:\s+(✅完成))?\s+·\s+(.+?)\s*$/gm;
const FIELD = /^(?:\*\*理解\*\*[：:]|主题[：:]|标签[：:]|时间[：:])/;

function invalid(message: string): never {
  throw new LegacyBackupFormatError(message);
}

function parseLegacyDateTime(value: string, label: string): number {
  const normalized = value
    .trim()
    .replace(/[年月]/g, '/')
    .replace(/日/g, ' ')
    .replace(/[，,]/g, ' ')
    .replace(/\s+/g, ' ');
  const match = normalized.match(
    /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:\s+(上午|下午)?\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/,
  );
  if (!match) invalid(`${label}无法识别：${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let hour = Number(match[5] ?? 0);
  const minute = Number(match[6] ?? 0);
  const second = Number(match[7] ?? 0);
  if (match[4] === '下午' && hour < 12) hour += 12;
  if (match[4] === '上午' && hour === 12) hour = 0;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
    || date.getSeconds() !== second) {
    invalid(`${label}无效：${value}`);
  }
  return date.getTime();
}

function kindFromLabel(label: string): EntryKind {
  if (label === '待办') return 'task';
  if (label === '想法') return 'idea';
  return 'info';
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function fieldValue(lines: string[], pattern: RegExp): string | null {
  const line = lines.find(candidate => pattern.test(candidate.trim()));
  if (!line) return null;
  return line.trim().replace(pattern, '').trim() || null;
}

function parseRecord(
  markdown: string,
  match: RegExpExecArray,
  blockEnd: number,
  index: number,
): Entry {
  const lines = markdown.slice(match.index + match[0].length, blockEnd).replace(/\r/g, '').split('\n');
  const quoteIndex = lines.findIndex(line => /^\s*>/.test(line));
  if (quoteIndex < 0) invalid(`第 ${index + 1} 条记录缺少原文`);

  const rawLines: string[] = [];
  for (let lineIndex = quoteIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (lineIndex > quoteIndex && (FIELD.test(trimmed) || trimmed === '---')) break;
    rawLines.push(lineIndex === quoteIndex ? line.replace(/^\s*>\s?/, '') : line);
  }
  const rawText = trimBlankEdges(rawLines).join('\n').trim();
  if (!rawText) invalid(`第 ${index + 1} 条记录原文为空`);

  const createdAt = parseLegacyDateTime(match[3], `第 ${index + 1} 条创建时间`);
  const dueText = fieldValue(lines, /^时间[：:]\s*/);
  const dueAt = dueText ? parseLegacyDateTime(dueText, `第 ${index + 1} 条待办时间`) : null;
  const summary = fieldValue(lines, /^\*\*理解\*\*[：:]\s*/) ?? rawText;
  const topic = fieldValue(lines, /^主题[：:]\s*/);
  const tagsText = fieldValue(lines, /^标签[：:]\s*/);
  const tags = tagsText ? tagsText.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean) : [];
  const kind = kindFromLabel(match[1]);
  const done = match[2] ? 1 : 0;
  const fingerprint = legacyEntryFingerprint({ rawText, kind, summary, dueAt, topic, tags, createdAt, done });
  const id = `legacy-import-${fingerprint}`;

  return {
    id,
    rawText,
    kind,
    summary,
    dueAt,
    timePrecision: inferTimePrecision(rawText, dueAt),
    remindAt: dueAt,
    topic,
    tags,
    persons: [],
    parseStatus: 'manual',
    parseSource: 'manual',
    correctedFrom: null,
    createdAt,
    updatedAt: createdAt,
    revisionAt: createdAt,
    done,
    doneAt: null,
    source: 'text',
  };
}

/** Parse the exact human-readable Markdown emitted before the V2 data capsule existed. */
export function parseLegacyExportMarkdown(markdown: string): LegacyBackupEnvelope {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^# 我的个人助手记录\s*$/m.test(normalized)) invalid('不是私人助手的旧版导出日志');

  const matches = [...normalized.matchAll(HEADER)];
  if (matches.length === 0) invalid('旧版导出日志中没有可导入的记录');

  const unique = new Map<string, Entry>();
  let duplicateCount = 0;
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const blockEnd = index + 1 < matches.length ? matches[index + 1].index! : normalized.length;
    const entry = parseRecord(normalized, match, blockEnd, index);
    if (unique.has(entry.id)) duplicateCount += 1;
    else unique.set(entry.id, entry);
  }
  const entries = [...unique.values()].sort((left, right) => (
    left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  ));
  return {
    format: 'assistant-app-export-v1',
    exportedAt: entries[entries.length - 1].createdAt,
    entries,
    duplicateCount,
  };
}
