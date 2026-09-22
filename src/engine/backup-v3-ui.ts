import type { BackupV3ImportPreview } from './backup-v3-import';

export const BACKUP_V3_PRIVATE_CONTENT_WARNING =
  '此备份包含私人对话、事件和长期记忆，请只从可信位置恢复并妥善保管文件。';

export interface BackupV3PreviewModel {
  contentLines: string[];
  mergeLine: string;
  conversationRangeLabel: string | null;
  warnings: string[];
}

export interface BackupV3ResultSummary {
  added: number;
  updated: number;
  conflicts: number;
  operationSkipped: number;
  projectionPending: boolean;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

export function buildBackupV3PreviewModel(preview: BackupV3ImportPreview): BackupV3PreviewModel {
  const counts = preview.objectCounts;
  return {
    contentLines: [
      `对话 ${counts.conversations} 条 · 事件 ${counts.events} 个`,
      `待办 ${counts.todos} 条 · 进展 ${counts.eventUpdates} 条`,
      `关系 ${counts.relations} 条 · 记忆 ${counts.memories} 条`,
    ],
    mergeLine: `新增 ${preview.added} · 更新 ${preview.updated} · 忽略 ${preview.ignored} · 冲突 ${preview.conflicts}`,
    conversationRangeLabel: preview.conversationRange
      ? `${formatDate(preview.conversationRange.firstAt)} – ${formatDate(preview.conversationRange.lastAt)}`
      : null,
    warnings: [
      BACKUP_V3_PRIVATE_CONTENT_WARNING,
      ...(preview.operationSkipped > 0
        ? [`${preview.operationSkipped} 条历史回执不会恢复撤销能力。`]
        : []),
    ],
  };
}

export function buildBackupV3ResultMessage(result: BackupV3ResultSummary): string {
  const restored = result.added + result.updated;
  const lines = [
    `${restored} 项已恢复。`,
    ...(result.conflicts > 0 ? [`${result.conflicts} 项保留了本机较新版本。`] : []),
    ...(result.operationSkipped > 0
      ? [`${result.operationSkipped} 条历史回执未恢复撤销能力。`]
      : []),
    ...(result.projectionPending
      ? ['通知、日历或搜索索引将在后台继续重建，不影响已恢复的数据。']
      : []),
  ];
  return lines.join('\n');
}
