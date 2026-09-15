import type { AssistantDateProposal, AssistantTimePrecision } from './action-types';

export type ModelDateProjection = {
  dueAt: number | null;
  timePrecision: AssistantTimePrecision | null;
};

export type ModelDateProjectionResult =
  | { ok: true; value: ModelDateProjection }
  | { ok: false; reason: 'invalid_date_protocol' | 'invalid_calendar_date' };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export function projectModelDate(date: AssistantDateProposal): ModelDateProjectionResult {
  if (date.dateStatus === 'absent' || date.dateStatus === 'ambiguous') {
    return { ok: true, value: { dueAt: null, timePrecision: null } };
  }

  const dateMatch = date.dueDate.match(DATE_RE);
  if (!dateMatch) return { ok: false, reason: 'invalid_date_protocol' };
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  let hour = 9;
  let minute = 0;
  if (date.timePrecision === 'dateTime') {
    const timeMatch = date.dueTime?.match(TIME_RE);
    if (!timeMatch) return { ok: false, reason: 'invalid_date_protocol' };
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (hour > 23 || minute > 59) return { ok: false, reason: 'invalid_calendar_date' };
  } else if (date.dueTime !== undefined) {
    return { ok: false, reason: 'invalid_date_protocol' };
  }

  const projected = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (projected.getFullYear() !== year
    || projected.getMonth() !== month - 1
    || projected.getDate() !== day
    || projected.getHours() !== hour
    || projected.getMinutes() !== minute) {
    return { ok: false, reason: 'invalid_calendar_date' };
  }

  return {
    ok: true,
    value: { dueAt: projected.getTime(), timePrecision: date.timePrecision },
  };
}
