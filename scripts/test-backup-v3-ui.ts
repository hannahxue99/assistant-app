import {
  BACKUP_V3_PRIVATE_CONTENT_WARNING,
  buildBackupV3PreviewModel,
  buildBackupV3ResultMessage,
} from '../src/engine/backup-v3-ui';
import type { BackupV3ImportPreview } from '../src/engine/backup-v3-import';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function includes(actual: string | string[], expected: string) {
  const text = Array.isArray(actual) ? actual.join('\n') : actual;
  if (!text.includes(expected)) throw new Error(`未找到文案：${expected}\n${text}`);
}

const preview: BackupV3ImportPreview = {
  added: 311,
  updated: 9,
  ignored: 4,
  conflicts: 2,
  operationSkipped: 1,
  profileWillImport: true,
  objectCounts: {
    conversations: 268,
    todos: 43,
    events: 12,
    eventUpdates: 67,
    relations: 104,
    memories: 18,
  },
  conversationRange: { firstAt: 1_700_000_000_000, lastAt: 1_710_000_000_000 },
};

check('V3 预览展示内容数量和合并结果', () => {
  const model = buildBackupV3PreviewModel(preview);
  includes(model.contentLines, '对话 268 条 · 事件 12 个');
  includes(model.contentLines, '待办 43 条 · 进展 67 条');
  includes(model.contentLines, '关系 104 条 · 记忆 18 条');
  includes(model.mergeLine, '新增 311 · 更新 9 · 忽略 4 · 冲突 2');
});

check('V3 预览展示对话日期范围', () => {
  const model = buildBackupV3PreviewModel(preview);
  if (!model.conversationRangeLabel?.includes('–')) throw new Error('缺少对话日期范围');
});

check('V3 预览明确私人内容和跳过回执', () => {
  const model = buildBackupV3PreviewModel(preview);
  includes(model.warnings, BACKUP_V3_PRIVATE_CONTENT_WARNING);
  includes(model.warnings, '1 条历史回执不会恢复撤销能力');
});

check('V3 结果区分事实恢复与待处理投影', () => {
  const message = buildBackupV3ResultMessage({
    added: 311, updated: 9, conflicts: 2, operationSkipped: 1, projectionPending: true,
  });
  includes(message, '320 项已恢复');
  includes(message, '2 项保留了本机较新版本');
  includes(message, '1 条历史回执未恢复撤销能力');
  includes(message, '将在后台继续重建');
});

check('无对话和无警告时不制造多余文案', () => {
  const model = buildBackupV3PreviewModel({
    ...preview,
    operationSkipped: 0,
    conversationRange: null,
  });
  if (model.conversationRangeLabel !== null) throw new Error('无对话时不应显示日期范围');
  if (model.warnings.length !== 1) throw new Error('不应显示回执警告');
});

console.log(`\n结果：${passed} 通过，0 失败`);
