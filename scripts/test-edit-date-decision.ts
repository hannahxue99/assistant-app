import type { Entry } from '../src/types';
import {
  analyzeEntryDateEdit,
  inspectDateEvidence,
  normalizeEntryDateTexts,
} from '../src/engine/edit-date-decision';

const at = (day: number) => new Date(2026, 8, day, 9).getTime();
const previous = (summary: string, rawText: string, dueAt: number | null): Entry => ({
  id: 'entry', kind: dueAt ? 'task' : 'info', summary, rawText, dueAt, remindAt: dueAt,
  topic: '测试', tags: [], persons: [], parseStatus: 'manual', parseSource: 'manual',
  correctedFrom: null, createdAt: at(1), updatedAt: at(1), revisionAt: at(1), done: 0,
  doneAt: null, source: 'text',
});

const referenceAt = at(7);

function equal<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) throw new Error(`${message ?? '断言失败'}：期望 ${String(expected)}，实际 ${String(actual)}`);
}

equal(inspectDateEvidence('9月10日开会', referenceAt).kind, 'single');
equal(inspectDateEvidence('9月10日开会，9月12日交材料', referenceAt).kind, 'ambiguous');
equal(inspectDateEvidence('今天9月7日开会', referenceAt).kind, 'single', '同一天的重复表达不算冲突');

let result = analyzeEntryDateEdit(previous('9月10日买菜', '买菜', at(10)), '9月10日买水果', '买菜', referenceAt);
equal(result.kind, 'direct', '只改标题措辞且日期不变');

result = analyzeEntryDateEdit(previous('9月10日买菜', '买菜', at(10)), '9月12日买菜', '买菜', referenceAt);
equal(result.kind, 'confirm-change', '只改标题日期需确认');

result = analyzeEntryDateEdit(previous('买菜', '买菜', null), '9月12日买菜', '买菜', referenceAt);
equal(result.kind, 'confirm-change', '只改标题：无日期变为有日期');

result = analyzeEntryDateEdit(previous('9月10日买菜', '买菜', at(10)), '买菜', '买菜', referenceAt);
equal(result.kind, 'confirm-clear', '只改标题：删除唯一日期');

result = analyzeEntryDateEdit(previous('买菜', '9月10日买菜', at(10)), '买菜', '9月12日买菜', referenceAt);
equal(result.kind, 'confirm-change', '只改正文日期需确认');

result = analyzeEntryDateEdit(previous('买菜', '买菜', null), '买菜', '9月12日买菜', referenceAt);
equal(result.kind, 'confirm-change', '只改正文：无日期变为有日期');

result = analyzeEntryDateEdit(previous('买菜', '9月10日买菜', at(10)), '买菜', '买菜', referenceAt);
equal(result.kind, 'confirm-clear', '只改正文：删除唯一日期');

result = analyzeEntryDateEdit(previous('买菜', '买菜', null), '买水果', '买葡萄', referenceAt);
equal(result.kind, 'direct', '标题正文同时修改但始终无日期');

result = analyzeEntryDateEdit(previous('9月10日买菜', '9月10日买菜', at(10)), '买菜', '买菜', referenceAt);
equal(result.kind, 'confirm-clear', '标题正文同时删除日期需确认清除');

result = analyzeEntryDateEdit(previous('买菜', '买菜', null), '9月12日买菜', '9月12日买水果', referenceAt);
equal(result.kind, 'confirm-change', '无日期记录同时新增同一天只确认一次');

result = analyzeEntryDateEdit(previous('9月10日买菜', '9月10日买菜', at(10)), '9月12日买菜', '9月12日买水果', referenceAt);
equal(result.kind, 'confirm-change', '标题正文同时改为同一新日期');

result = analyzeEntryDateEdit(previous('9月10日买菜', '买菜', at(10)), '买水果', '9月10日买水果', referenceAt);
equal(result.kind, 'direct', '日期从标题移动到正文但没有改变');

result = analyzeEntryDateEdit(previous('买菜', '9月10日买菜', at(10)), '9月10日买水果', '买水果', referenceAt);
equal(result.kind, 'direct', '日期从正文移动到标题但没有改变');

result = analyzeEntryDateEdit(previous('9月10日买菜', '9月10日买菜', at(10)), '9月11日买菜', '9月12日买菜', referenceAt);
equal(result.kind, 'conflict', '标题正文日期不一致');

result = analyzeEntryDateEdit(previous('买菜', '买菜', null), '9月10日开会，9月12日交材料', '买菜', referenceAt);
equal(result.kind, 'ambiguous', '单字段多个不同日期不自动猜测');

let normalized = normalizeEntryDateTexts('9月10日买菜', '9月12日下班买菜', at(12));
equal(normalized.title, '9月12日买菜', '正文改日期后同步标题旧日期');
equal(normalized.body, '9月12日下班买菜');

normalized = normalizeEntryDateTexts('买菜', '明天买菜', at(8));
equal(normalized.title, '9月8日买菜', '有待办日期时标题必须补具体日期');
equal(normalized.body, '9月8日买菜', '正文相对日期必须固定成具体日期');

normalized = normalizeEntryDateTexts('9月10日买菜', '下班买菜', at(12));
equal(normalized.title, '9月12日买菜', '只改标题日期时使用最终日期');
equal(normalized.body, '下班买菜', '正文没有日期时不凭空添加');
console.log('编辑日期决策测试通过：标题、正文、联合编辑及有无日期组合');
