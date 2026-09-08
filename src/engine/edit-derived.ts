import type { Entry } from '../types';

export function deriveEditedEntry(previous: Entry, title: string, body: string, now: number) {
  if (body === previous.rawText) return { summary: title };
  const kind = previous.dueAt !== null || /提醒|记得|别忘了|要[去办做买]|帮我|买|购买|预约|提交|交费|还款/.test(body)
    ? 'task' as const
    : /想到|灵感|想法|感觉|觉得|或许|也许/.test(body) ? 'idea' as const : 'info' as const;
  // 标题和日期都是用户控制字段：正文变化不能在数据库层静默改写它们。
  // 日期确认由详情页完成，并通过 applyCorrection.patch.dueAt 显式提交。
  return { summary: title, kind };
}
