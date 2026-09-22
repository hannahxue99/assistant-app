import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ImportPreview } from '../engine/import-merge';
import type { LegacyImportPreview } from '../assistant/legacy-import';
import type { BackupV3ImportPreview } from '../engine/backup-v3-import';
import { buildBackupV3PreviewModel } from '../engine/backup-v3-ui';
import { theme } from '../theme';

export type ImportPreviewData =
  | { kind: 'v3'; value: BackupV3ImportPreview }
  | { kind: 'v2'; value: ImportPreview }
  | { kind: 'legacy'; value: LegacyImportPreview };

interface Props {
  visible: boolean;
  fileName: string;
  exportedAt: number | null;
  preview: ImportPreviewData | null;
  importing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function formatBackupTime(timestamp: number | null): string {
  if (timestamp === null) return '';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function ImportPreviewModal({
  visible,
  fileName,
  exportedAt,
  preview,
  importing,
  onCancel,
  onConfirm,
}: Props) {
  const legacy = preview?.kind === 'legacy' ? preview.value : null;
  const current = preview?.kind === 'v2' ? preview.value : null;
  const v3 = preview?.kind === 'v3' ? preview.value : null;
  const v3Model = v3 ? buildBackupV3PreviewModel(v3) : null;
  const metrics = legacy
    ? [
      { value: legacy.conversations, label: '对话' },
      { value: legacy.todos, label: '待办' },
      { value: legacy.events, label: '事件' },
      { value: legacy.duplicates, label: '重复' },
    ]
    : [
      { value: v3?.added ?? current?.added ?? 0, label: '新增' },
      { value: v3?.updated ?? current?.updated ?? 0, label: '更新' },
      { value: v3?.ignored ?? current?.ignored ?? 0, label: '忽略' },
      { value: v3?.conflicts ?? current?.conflicts ?? 0, label: '冲突' },
    ];
  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={importing ? undefined : onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="document-text-outline" size={21} color={theme.colors.accent} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{legacy ? '识别到旧版导出日志' : '导入预览'}</Text>
              <Text style={styles.subtitle}>
                {legacy ? '记录截至' : '备份于'} {formatBackupTime(exportedAt)}
              </Text>
            </View>
          </View>

          <View style={styles.fileBox}>
            <Text style={styles.fileName} numberOfLines={2}>{fileName}</Text>
          </View>

          {!!v3Model && (
            <View style={styles.contentSummary}>
              {v3Model.contentLines.map(line => (
                <Text key={line} style={styles.contentLine}>{line}</Text>
              ))}
              {!!v3Model.conversationRangeLabel && (
                <Text style={styles.rangeLine}>对话日期　{v3Model.conversationRangeLabel}</Text>
              )}
            </View>
          )}

          <View style={styles.metrics}>
            {metrics.map(metric => (
              <View key={metric.label} style={styles.metric}>
                <Text style={styles.metricValue}>{metric.value}</Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>
            ))}
          </View>

          {!!current && (current.memoryAdded + current.memoryUpdated + current.memoryIgnored + current.memoryConflicts > 0) && (
            <Text style={styles.memorySummary}>
              长期记忆　新增 {current.memoryAdded} · 更新 {current.memoryUpdated} · 保留 {current.memoryIgnored + current.memoryConflicts}
            </Text>
          )}

          <View style={styles.noteRow}>
            <Ionicons
              name={v3 ? 'alert-circle-outline' : 'shield-checkmark-outline'}
              size={17}
              color={v3 ? theme.colors.accent : theme.colors.green}
            />
            <Text style={styles.note}>
              {legacy
                ? '旧原文按原时间进入小知；待办和事件直接恢复。不会调用模型，也不会生成助手回复。'
                : v3Model
                  ? `${v3Model.warnings.join('\n')}\n冲突不会静默覆盖本机较新内容。${v3?.profileWillImport ? ' 默认画像将从备份恢复。' : ''}`
                  : `本地已有内容不会因备份缺失而删除；冲突记录将保留历史版本。${current?.profileWillImport ? ' 默认画像将从备份恢复。' : ''}`}
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={importing}
              onPress={onCancel}
              style={({ pressed }) => [styles.button, styles.cancelButton, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={importing || !preview}
              onPress={onConfirm}
              style={({ pressed }) => [styles.button, styles.confirmButton, pressed && styles.pressed]}
            >
              {importing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmText}>确认导入</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(43, 38, 34, 0.42)',
    padding: 16,
  },
  sheet: {
    backgroundColor: theme.colors.card,
    borderRadius: 22,
    padding: 18,
    gap: 13,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: theme.colors.text, fontSize: theme.font.heading, fontWeight: '700' },
  subtitle: { color: theme.colors.textDim, fontSize: theme.font.small },
  fileBox: { backgroundColor: theme.colors.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  fileName: { color: theme.colors.text, fontSize: theme.font.small },
  contentSummary: { gap: 5, paddingHorizontal: 2 },
  contentLine: { color: theme.colors.text, fontSize: theme.font.small, lineHeight: 19 },
  rangeLine: { color: theme.colors.textDim, fontSize: 11, lineHeight: 17 },
  metrics: { flexDirection: 'row', gap: 6 },
  metric: { flex: 1, alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 10, paddingVertical: 9 },
  metricValue: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  metricLabel: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  memorySummary: { color: theme.colors.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  note: { flex: 1, color: theme.colors.textDim, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { minHeight: theme.touchTarget, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelButton: { flex: 1, backgroundColor: theme.colors.bg },
  confirmButton: { flex: 1.65, backgroundColor: theme.colors.accent },
  cancelText: { color: theme.colors.text, fontSize: theme.font.body, fontWeight: '600' },
  confirmText: { color: '#fff', fontSize: theme.font.body, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
