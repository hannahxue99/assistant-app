import {
  LegacyBackupFormatError,
  parseLegacyExportMarkdown,
} from '../src/engine/legacy-backup';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectInvalid(markdown: string, message: string) {
  try {
    parseLegacyExportMarkdown(markdown);
  } catch (error) {
    check(error instanceof LegacyBackupFormatError, message);
    return;
  }
  throw new Error(message);
}

const markdown = `# 我的个人助手记录

## 待办 ✅完成 · 2026/9/15 12:43:00

> 下个月11号还款10万

**理解**：偿还房贷10万元

主题：房贷还款

标签：贷款、还款

时间：2026/10/11 09:00:00

---

## 想法 · 2026/9/15 13:20:00

> 复盘一下长期陪伴产品

主题：产品 V0.3

---

## 信息 · 2026/9/15 14:00:00

> 今天状态不错

---
`;

const parsed = parseLegacyExportMarkdown(markdown);
check(parsed.format === 'assistant-app-export-v1', '应识别为旧版导出日志');
check(parsed.entries.length === 3, '应解析全部三条旧记录');
check(parsed.duplicateCount === 0, '不同记录不应被误判为重复');
check(parsed.entries[0].kind === 'task' && parsed.entries[0].done === 1, '应保留待办与完成态');
check(parsed.entries[0].rawText === '下个月11号还款10万', '必须保留旧原文');
check(parsed.entries[0].summary === '偿还房贷10万元', '应保留旧理解标题');
check(parsed.entries[0].topic === '房贷还款', '应保留旧主题');
check(parsed.entries[0].tags.join(',') === '贷款,还款', '应保留旧标签');
check(new Date(parsed.entries[0].createdAt).getFullYear() === 2026, '应按标题解析原创建时间');
check(new Date(parsed.entries[0].dueAt!).getMonth() === 9, '应解析旧待办到期时间');
check(parsed.entries[0].timePrecision === 'date', '没有明确钟点的原文不得因旧默认9点变成定时待办');
check(parsed.entries[1].kind === 'idea' && parsed.entries[1].topic === '产品 V0.3', '应解析带主题想法');
check(parsed.entries[2].summary === parsed.entries[2].rawText, '没有理解字段时标题等于原文');
check(parsed.entries.every(entry => entry.id.startsWith('legacy-import-')), '旧日志应生成稳定命名空间 ID');

const repeated = parseLegacyExportMarkdown(`${markdown}\n${markdown.slice(markdown.indexOf('## 信息'))}`);
check(repeated.entries.length === 3 && repeated.duplicateCount === 1, '文件内完全重复记录应稳定去重');

expectInvalid('# 随手写的 Markdown\n\n## 待办 · 2026/9/15 10:00:00\n\n> 测试', '不应猜测导入任意 Markdown');
expectInvalid('# 我的个人助手记录\n\n## 待办 · 昨天\n\n> 测试', '无法确定时间时必须拒绝整份文件');
expectInvalid('# 我的个人助手记录\n\n## 待办 · 2026/9/15 10:00:00', '缺少原文时必须拒绝');

console.log('legacy backup parser tests passed');
