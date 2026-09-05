import type { Entry } from '../types';
import { extractRelativeDateExpression, hasTimeHint, parseChineseTime } from './time';

export function deriveEditedEntry(previous: Entry, title: string, body: string, now: number) {
  if (body === previous.rawText) return { summary: title };
  const dueAt = hasTimeHint(body) ? parseChineseTime(body, now).dueAt : null;
  const kind = dueAt !== null || /提醒|记得|别忘了|要[去办做买]|帮我|买|购买|预约|提交|交费|还款/.test(body)
    ? 'task' as const
    : /想到|灵感|想法|感觉|觉得|或许|也许/.test(body) ? 'idea' as const : 'info' as const;
  let summary = title;
  if (title === previous.summary) {
    summary = body;
    const relative = extractRelativeDateExpression(body);
    if (relative && dueAt !== null) {
      const date = new Date(dueAt);
      summary = body.replace(relative, `${date.getMonth() + 1}月${date.getDate()}日`);
    }
  }
  return { summary, dueAt, kind };
}
