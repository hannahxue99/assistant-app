/**
 * 理解服务 — 编排规则 + LLM + 降级链
 *
 * 流程（对应 PRD"输入→理解→归档→浮现"第②步）：
 *   1. 规则层：本地时间归一化（确定、离线）
 *   2. 若 LLM 开启：LLM 判断意图/标题/标签/主题/人物
 *   3. 降级链：LLM 失败 → 纯规则兜底，条目保持可读，联网后重试
 *
 * 关键原则：记录永不阻塞。调用方先 insertEntry(原文)，再 fire-and-forget 跑这里回填。
 */
import {
  getEntry,
  insertEntry,
  listActiveTopics,
  listParseFailed,
  setParseStatus,
  updateParsedResult,
} from '../db';
import type { Entry, NewEntryInput, Settings } from '../types';
import { extractRelativeDateExpression, hasTimeHint, parseChineseTime } from './time';
import { LlmError, understandWithLlm } from './llm';
import { notifyEntryChanges } from './entry-events';

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 标题时间具体化：把"明天/后天/下周六/周X"等相对词换成"M月D日"。
 * "明天买葡萄" → "9月2日买葡萄"；无相对词或换算不出则原样返回。
 */
export function concretizeDateInText(text: string, now = Date.now()): string {
  const relativeText = extractRelativeDateExpression(text);
  if (!relativeText) return text;
  const parsed = parseChineseTime(relativeText, now);
  if (!parsed.dueAt) return text;
  const d = new Date(parsed.dueAt);
  const concrete = `${d.getMonth() + 1}月${d.getDate()}日`;
  return text.replace(relativeText, concrete);
}
import { syncEntryReminder } from './notifications';

/** 纯规则理解（LLM 关闭或失败时兜底） */
export function understandWithRules(rawText: string, now = Date.now()): {
  kind: 'task' | 'idea' | 'info';
  summary: string;
  dueAt: number | null;
  tags: string[];
  topic: string | null;
  persons: string[];
} {
  const time = hasTimeHint(rawText) ? parseChineseTime(rawText, now) : null;
  const dueAt = time?.dueAt ?? null;

  let kind: 'task' | 'idea' | 'info' = 'info';
  if (dueAt !== null) {
    kind = 'task'; // 带明确时间 → 待办
  } else if (/提醒|记得|别忘了|要[去办做买]|帮我/.test(rawText)) {
    kind = 'task';
  } else if (/想到|灵感|想法|感觉|觉得|或许|也许/.test(rawText)) {
    kind = 'idea';
  }

  // 简单标签：抓 #xxx 显式标签
  const tags = Array.from(rawText.matchAll(/#([\w\u4e00-\u9fa5-]+)/g)).map((m) => m[1]);

  return { kind, summary: concretizeDateInText(rawText, now), dueAt, tags, topic: null, persons: [] };
}

/**
 * 处理一条新条目：先规则(快)，后 LLM(精) 回填。
 * 返回是否成功应用了 LLM 结果。
 */
type UnderstandingResult = 'llm' | 'rule' | 'failed' | 'stale';
const runtime = globalThis as typeof globalThis & { __understandingJobs?: Map<string, Promise<UnderstandingResult>> };
const jobs = runtime.__understandingJobs ??= new Map();

export function understandEntry(entry: Entry, settings: Settings, signal?: AbortSignal): Promise<UnderstandingResult> {
  const existing = jobs.get(entry.id);
  if (existing) return existing;
  const job = processEntry(entry, settings, signal).finally(() => {
    jobs.delete(entry.id);
    notifyEntryChanges();
  });
  jobs.set(entry.id, job);
  return job;
}

async function processEntry(
  entry: Entry,
  settings: Settings,
  signal?: AbortSignal,
): Promise<UnderstandingResult> {
  const current = await getEntry(entry.id);
  if (!current || current.parseStatus === 'manual') return 'stale';
  entry = current;
  const now = entry.createdAt;

  // 规则层：时间归一化（总是本地先算，快且离线可靠）
  const time = hasTimeHint(entry.rawText) ? parseChineseTime(entry.rawText, now) : null;
  const ruleDueAt = time?.dueAt ?? null;

  // 尝试 LLM（若开启且有 key）
  if (settings.llmEnabled && settings.llmKey) {
    try {
      const activeTopics = await listActiveTopics(180, 100);
      const parsed = await understandWithLlm(entry.rawText, {
        baseUrl: settings.llmBaseUrl,
        key: settings.llmKey,
        model: settings.llmModel,
        activeTopics,
        referenceAt: now,
        dueAt: ruleDueAt,
      }, signal);
      // LLM 不做时间，规则的时间优先；LLM 给的 dueAt 忽略
      const finalKind = parsed.kind === 'info' && ruleDueAt !== null ? 'task' : parsed.kind;
      // LLM 偶尔忽略"具体日期"指令 → 本地再兜一次
      let finalSummary = concretizeDateInText(parsed.summary, now);
      if (ruleDueAt !== null) {
        const titleDate = hasTimeHint(finalSummary) ? parseChineseTime(finalSummary, now).dueAt : null;
        if (titleDate === null || new Date(titleDate).toDateString() !== new Date(ruleDueAt).toDateString()) {
          finalSummary = concretizeDateInText(entry.rawText, now);
        }
      }
      const applied = await updateParsedResult(entry.id, {
        kind: finalKind,
        summary: finalSummary,
        dueAt: ruleDueAt,
        tags: parsed.tags,
        topic: parsed.topic,
        persons: parsed.persons,
      }, 'llm', entry);
      if (!applied) return 'stale';
      // 理解可能改变 kind/topic → 同步到点提醒
      const ok = await getEntry(entry.id);
      if (ok) await syncEntryReminder(ok);
      return 'llm';
    } catch (e: any) {
      // LLM 失败 → 回落到规则
      if (signal?.aborted) return 'failed';
    }
  }

  // 规则兜底
  const rule = understandWithRules(entry.rawText, now);
  const kind = rule.kind === 'info' && ruleDueAt !== null ? 'task' : rule.kind;
  const failed = !!(settings.llmEnabled && settings.llmKey);
  const applied = await updateParsedResult(entry.id, {
    kind,
    summary: rule.summary,
    dueAt: ruleDueAt,
    tags: rule.tags,
    topic: rule.topic,
    persons: rule.persons,
  }, 'rule', entry, failed ? 'failed' : 'ok');
  if (!applied) return 'stale';
  const updated = await getEntry(entry.id);
  if (updated) await syncEntryReminder(updated);

  // LLM 开启但失败 → 落 parse_status='failed'（规则结果已回填、条目可读），
  // 下次启动联网时由 retryFailedUnderstandings 补理解
  if (settings.llmEnabled && settings.llmKey) {
    return 'failed';
  }
  return 'rule';
}

/**
 * 启动时补理解（PRD F2："失败标 pending，联网后补理解"）：
 * 重跑所有 parse_status='failed' 的条目。成功后 updateParsedResult 会写回 'ok'。
 * fire-and-forget，不阻塞启动。
 */
export async function retryFailedUnderstandings(settings: Settings): Promise<number> {
  if (!settings.llmEnabled || !settings.llmKey) return 0;
  const failed = await listParseFailed(50);
  for (const e of failed) {
    await understandEntry(e, settings).catch(() => {});
  }
  return failed.length;
}

/**
 * 处理新输入的完整入口（供 UI 调用）。
 * 同步插入原文（永不阻塞），返回条目；理解在后台异步完成。
 * onUnderstood：LLM 理解落库后回调（成功失败都调），供 UI 刷新展示精理解结果。
 */
export async function ingest(
  input: NewEntryInput,
  settings: Settings,
  onUnderstood?: () => void,
): Promise<Entry> {
  // 先插入，规则结果同步算好立即回填（保证首帧就是待办/时间正确）
  input = { ...input, createdAt: input.createdAt ?? Date.now() };
  const rule = understandWithRules(input.rawText, input.createdAt);
  const time = hasTimeHint(input.rawText) ? parseChineseTime(input.rawText, input.createdAt) : null;
  const ruleDueAt = time?.dueAt ?? null;
  const kind = rule.kind === 'info' && ruleDueAt !== null ? 'task' : rule.kind;

  const entry = await insertEntry(input, {
    kind,
    summary: rule.summary,
    dueAt: ruleDueAt,
    tags: rule.tags,
    topic: rule.topic,
    persons: rule.persons,
  });

  // 规则已算出时间 → 立即挂到点提醒（不等 LLM）
  await syncEntryReminder(entry);

  // 异步：LLM 精理解（不 await，不阻塞 UI；完成后回调刷新 UI）
  if (settings.llmEnabled && settings.llmKey) {
    await setParseStatus(entry.id, 'pending');
    const processingEntry: Entry = { ...entry, parseStatus: 'pending' };
    understandEntry(processingEntry, settings)
      .then((r) => console.log(`[understand] ${entry.id} ${r}: ${entry.rawText.slice(0, 20)}`))
      .catch(() => console.warn(`[understand] ${entry.id} 异常`))
      .finally(() => onUnderstood?.());
    return processingEntry;
  }

  return entry;
}
