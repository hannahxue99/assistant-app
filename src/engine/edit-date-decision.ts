import type { Entry } from '../types';
import { extractDateExpressions, hasTimeHint, parseChineseTime } from './time';

export type DateEvidence =
  | { kind: 'none' }
  | { kind: 'single'; dueAt: number; expression?: string }
  | { kind: 'ambiguous' };

export type EntryDateEditDecision =
  | { kind: 'direct'; dueAt: number | null }
  | { kind: 'confirm-change'; dueAt: number; source: 'title' | 'body' | 'both' }
  | { kind: 'confirm-clear' }
  | {
      kind: 'conflict';
      title: Extract<DateEvidence, { kind: 'single' }>;
      body: Extract<DateEvidence, { kind: 'single' }>;
    }
  | { kind: 'ambiguous'; field: 'title' | 'body' | 'both' };

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function sameCalendarDay(left: number | null | undefined, right: number | null | undefined): boolean {
  return left != null && right != null && dayKey(left) === dayKey(right);
}

export function inspectDateEvidence(text: string, referenceAt: number): DateEvidence {
  const expressions = extractDateExpressions(text);
  if (expressions.length === 0) {
    if (!hasTimeHint(text)) return { kind: 'none' };
    const parsed = parseChineseTime(text, referenceAt);
    return parsed.dueAt == null ? { kind: 'none' } : {
      kind: 'single', dueAt: parsed.dueAt, expression: parsed.matched ?? undefined,
    };
  }

  const candidates = expressions
    .map((expression) => ({ expression, dueAt: parseChineseTime(expression.text, referenceAt).dueAt }))
    .filter((candidate): candidate is { expression: typeof expressions[number]; dueAt: number } => candidate.dueAt != null);
  const uniqueDays = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) uniqueDays.set(dayKey(candidate.dueAt), candidate);
  if (uniqueDays.size === 0) return { kind: 'none' };
  if (uniqueDays.size > 1) return { kind: 'ambiguous' };
  const candidate = [...uniqueDays.values()][0];
  return { kind: 'single', dueAt: candidate.dueAt, expression: candidate.expression.text };
}

export function analyzeEntryDateEdit(
  previous: Entry,
  title: string,
  body: string,
  referenceAt: number,
): EntryDateEditDecision {
  const titleEvidence = inspectDateEvidence(title, referenceAt);
  const bodyEvidence = inspectDateEvidence(body, referenceAt);
  if (titleEvidence.kind === 'ambiguous' || bodyEvidence.kind === 'ambiguous') {
    return {
      kind: 'ambiguous',
      field: titleEvidence.kind === 'ambiguous' && bodyEvidence.kind === 'ambiguous'
        ? 'both' : titleEvidence.kind === 'ambiguous' ? 'title' : 'body',
    };
  }

  if (titleEvidence.kind === 'single' && bodyEvidence.kind === 'single'
    && !sameCalendarDay(titleEvidence.dueAt, bodyEvidence.dueAt)) {
    return { kind: 'conflict', title: titleEvidence, body: bodyEvidence };
  }

  const candidate = bodyEvidence.kind === 'single' ? bodyEvidence
    : titleEvidence.kind === 'single' ? titleEvidence : null;
  if (candidate) {
    if (sameCalendarDay(candidate.dueAt, previous.dueAt)) {
      return { kind: 'direct', dueAt: previous.dueAt };
    }
    const source = titleEvidence.kind === 'single' && bodyEvidence.kind === 'single'
      ? 'both' : bodyEvidence.kind === 'single' ? 'body' : 'title';
    return { kind: 'confirm-change', dueAt: candidate.dueAt!, source };
  }

  const previousHadDateText = inspectDateEvidence(previous.summary, previous.updatedAt).kind !== 'none'
    || inspectDateEvidence(previous.rawText, previous.updatedAt).kind !== 'none';
  if (previous.dueAt != null && previousHadDateText) return { kind: 'confirm-clear' };
  return { kind: 'direct', dueAt: previous.dueAt };
}

export function formatEditDate(timestamp: number | null): string {
  if (timestamp == null) return '无日期';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 用户明确选择冲突一侧后，将另一侧唯一日期表达式同步到同一天。 */
export function replaceSingleDateExpression(text: string, targetAt: number): string {
  const expressions = extractDateExpressions(text);
  if (expressions.length !== 1) return text;
  const expression = expressions[0];
  return `${text.slice(0, expression.start)}${formatEditDate(targetAt)}${text.slice(expression.end)}`;
}
