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
import { theme } from '../theme';

interface Props {
  visible: boolean;
  fileName: string;
  exportedAt: number | null;
  preview: ImportPreview | null;
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
              <Text style={styles.title}>导入预览</Text>
              <Text style={styles.subtitle}>备份于 {formatBackupTime(exportedAt)}</Text>
            </View>
          </View>

          <View style={styles.fileBox}>
            <Text style={styles.fileName} numberOfLines={2}>{fileName}</Text>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricValue}>{preview?.added ?? 0}</Text><Text style={styles.metricLabel}>新增</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{preview?.updated ?? 0}</Text><Text style={styles.metricLabel}>更新</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{preview?.ignored ?? 0}</Text><Text style={styles.metricLabel}>忽略</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{preview?.conflicts ?? 0}</Text><Text style={styles.metricLabel}>冲突</Text></View>
          </View>

          <View style={styles.noteRow}>
            <Ionicons name="shield-checkmark-outline" size={17} color={theme.colors.green} />
            <Text style={styles.note}>
              本地已有内容不会因备份缺失而删除；冲突记录将保留历史版本。
              {preview?.profileWillImport ? ' 默认画像将从备份恢复。' : ''}
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
  metrics: { flexDirection: 'row', gap: 6 },
  metric: { flex: 1, alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 10, paddingVertical: 9 },
  metricValue: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  metricLabel: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
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
