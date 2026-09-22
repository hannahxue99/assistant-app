/**
 * 「我的」页 — 长期记忆 + 助手与同步 + 待办通知 + 数据管理。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarSyncSetting } from '../../src/components/CalendarSyncSetting';
import { MemorySection } from '../../src/components/MemorySection';
import { ImportFeedbackModal } from '../../src/components/ImportFeedbackModal';
import { ImportPreviewModal, type ImportPreviewData } from '../../src/components/ImportPreviewModal';
import {
  clearPendingNotificationSync,
  firstEntryAt,
  getProfile,
  getSettings,
  importBackup,
  previewBackupImport,
  saveProfile,
} from '../../src/db';
import { BackupFormatError, parseImportableMarkdown } from '../../src/engine/backup-format';
import {
  BackupV3FormatError,
  parseBackupV3Markdown,
  type BackupEnvelopeV3,
} from '../../src/engine/backup-v3-format';
import {
  exportBackupV3Markdown,
  importBackupV3,
  previewBackupV3Import,
} from '../../src/engine/backup-v3-database';
import {
  BACKUP_V3_PRIVATE_CONTENT_WARNING,
  buildBackupV3ResultMessage,
} from '../../src/engine/backup-v3-ui';
import {
  LegacyBackupFormatError,
  parseLegacyExportMarkdown,
  type LegacyBackupEnvelope,
} from '../../src/engine/legacy-backup';
import { importLegacyExport, previewLegacyImport } from '../../src/assistant/legacy-import';
import { migrateLegacyEntriesToAssistantHistory } from '../../src/assistant/migration';
import { migrateLegacyTopicsToEvents } from '../../src/assistant/event-migration';
import { memorySectionState } from '../../src/assistant/memory-ui';
import {
  editMemory,
  forgetMemory,
  listActiveMemories,
  undoMemoryUiAction,
  type MemoryUiUndoToken,
} from '../../src/assistant/memory-store';
import type { AssistantMemory } from '../../src/assistant/memory-types';
import {
  ensurePermissions,
  scheduleDailyNotifications,
  syncEntryReminders,
} from '../../src/engine/notifications';
import type { BackupEnvelope, Profile, Settings } from '../../src/types';
import { theme } from '../../src/theme';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type ImportCandidate =
  | { kind: 'v3'; envelope: BackupEnvelopeV3; preview: ImportPreviewData }
  | { kind: 'v2'; envelope: BackupEnvelope; preview: ImportPreviewData }
  | { kind: 'legacy'; envelope: LegacyBackupEnvelope; preview: ImportPreviewData };

export default function ProfileScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [days, setDays] = useState(0);
  const [memories, setMemories] = useState<AssistantMemory[]>([]);
  const [memoryLoadedOnce, setMemoryLoadedOnce] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState(false);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const [memoryUndo, setMemoryUndo] = useState<{ label: string; token: MemoryUiUndoToken } | null>(null);
  const [importCandidate, setImportCandidate] = useState<ImportCandidate | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const loadMemories = useCallback(async () => {
    if (!memoryLoadedOnce) setMemoryLoading(true);
    try {
      setMemories(await listActiveMemories());
      setMemoryLoadedOnce(true);
      setMemoryError(false);
    } catch {
      setMemoryError(true);
    } finally {
      setMemoryLoading(false);
    }
  }, [memoryLoadedOnce]);

  const load = useCallback(async () => {
    void loadMemories();
    const results = await Promise.allSettled([getSettings(), getProfile(), firstEntryAt()]);
    if (results[0].status === 'fulfilled') setSettings(results[0].value);
    if (results[1].status === 'fulfilled') setProfile(results[1].value);
    if (results[2].status === 'fulfilled') {
      const first = results[2].value;
      setDays(first ? Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1) : 0);
    }
  }, [loadMemories]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!memoryUndo) return;
    const timer = setTimeout(() => setMemoryUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [memoryUndo]);

  async function saveLongTermMemory(memory: AssistantMemory, content: string) {
    setMemoryBusyId(memory.id);
    try {
      const result = await editMemory({ id: memory.id, expectedRevision: memory.revision, content });
      if (!result) {
        await loadMemories();
        Alert.alert('这条记忆刚有新变化', '已经刷新为最新内容，请再修改一次。');
        return;
      }
      await loadMemories();
      setMemoryUndo({ label: '已更新一条记忆', token: result.undo });
    } finally {
      setMemoryBusyId(null);
    }
  }

  async function forgetLongTermMemory(memory: AssistantMemory) {
    setMemoryBusyId(memory.id);
    try {
      const result = await forgetMemory({ id: memory.id, expectedRevision: memory.revision });
      if (!result) {
        await loadMemories();
        Alert.alert('这条记忆刚有新变化', '已经刷新为最新内容。');
        return;
      }
      setMemories(current => current.filter(item => item.id !== memory.id));
      setMemoryUndo({ label: '已忘记', token: result.undo });
    } finally {
      setMemoryBusyId(null);
    }
  }

  async function undoLastMemoryAction() {
    const current = memoryUndo;
    if (!current) return;
    setMemoryUndo(null);
    const restored = await undoMemoryUiAction(current.token);
    await loadMemories();
    if (!restored) Alert.alert('无法撤销', '这条记忆已经发生了新的变化。');
  }

  async function toggleNotify(key: 'notifyMorning' | 'notifyEvening', v: boolean) {
    if (!profile) return;
    const prev = profile;
    const next = { ...prev, [key]: v };
    setProfile(next);
    await saveProfile(next);
    if (v) {
      // 打开开关时确认/请求通知权限（首次授权弹窗在这里出现）
      const granted = await ensurePermissions();
      if (!granted) {
        setProfile(prev);
        await saveProfile(prev);
        Alert.alert('通知未授权', '请在系统设置 → 通知 中允许「私人助手」，然后重新打开开关。');
        return;
      }
    }
    await scheduleDailyNotifications();
  }

  async function performExport() {
    try {
      const md = await exportBackupV3Markdown();
      // 写成 .md 文件再分享：微信等应用不接受纯文本分享，文件形式全平台可用
      const stamp = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.cacheDirectory}私人助手备份-${stamp}.md`;
      await FileSystem.writeAsStringAsync(uri, md);
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || typeof info.size !== 'number') {
        throw new Error('无法确认备份文件大小，请稍后重试');
      }
      if (info.size > MAX_IMPORT_BYTES) {
        throw new Error('完整备份超过 10 MB，当前版本无法安全导出可重新导入的文件');
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/markdown',
          dialogTitle: '导出数据',
          UTI: 'public.text',
        });
      } else {
        await Share.share({ message: md, title: '私人助手备份' });
      }
    } catch (e: any) {
      Alert.alert('导出失败', String(e?.message ?? e));
    }
  }

  function doExport() {
    Alert.alert(
      '导出完整备份',
      BACKUP_V3_PRIVATE_CONTENT_WARNING,
      [
        { text: '取消', style: 'cancel' },
        { text: '继续导出', onPress: () => void performExport() },
      ],
    );
  }

  function importErrorMessage(error: unknown): string {
    if (error instanceof BackupV3FormatError) {
      if (error.code === 'UNSUPPORTED_VERSION') {
        return '该备份由更新版本的 App 生成，请升级「私人助手」后再导入。';
      }
      return `备份文件无效：${error.message}`;
    }
    if (error instanceof BackupFormatError) {
      if (error.code === 'UNSUPPORTED_VERSION') {
        return '该备份由更新版本的 App 生成，请升级「私人助手」后再导入。';
      }
      return `备份文件无效：${error.message}`;
    }
    if (error instanceof LegacyBackupFormatError) return `旧版日志无效：${error.message}`;
    return String((error as any)?.message ?? error);
  }

  function closeImportPreview() {
    if (importing) return;
    setImportCandidate(null);
    setImportFileName('');
  }

  async function chooseImportFile() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset.name.toLowerCase().endsWith('.md')) {
        setImportFeedback({ kind: 'error', message: '请选择由「私人助手」导出的 .md 文件；现有数据没有发生变化。' });
        return;
      }
      const info = asset.size === undefined ? await FileSystem.getInfoAsync(asset.uri) : null;
      const size = asset.size ?? (info?.exists ? info.size : 0);
      if (size > MAX_IMPORT_BYTES) {
        setImportFeedback({ kind: 'error', message: '文件超过 10 MB，请选择体积更小的 Markdown 备份；现有数据没有发生变化。' });
        return;
      }
      const markdown = await FileSystem.readAsStringAsync(asset.uri);
      let candidate: ImportCandidate;
      try {
        const envelope = parseBackupV3Markdown(markdown);
        const preview = await previewBackupV3Import(envelope.payload);
        candidate = { kind: 'v3', envelope, preview: { kind: 'v3', value: preview } };
      } catch (error) {
        if (!(error instanceof BackupV3FormatError) || error.code !== 'LEGACY_OR_UNKNOWN') throw error;
        try {
          const envelope = parseImportableMarkdown(markdown);
          const preview = await previewBackupImport(envelope.payload);
          candidate = { kind: 'v2', envelope, preview: { kind: 'v2', value: preview } };
        } catch (fallbackError) {
          if (!(fallbackError instanceof BackupFormatError) || fallbackError.code !== 'LEGACY_OR_UNKNOWN') {
            throw fallbackError;
          }
          const envelope = parseLegacyExportMarkdown(markdown);
          const preview = await previewLegacyImport(envelope);
          candidate = { kind: 'legacy', envelope, preview: { kind: 'legacy', value: preview } };
        }
      }
      setImportFileName(asset.name);
      setImportCandidate(candidate);
    } catch (error) {
      setImportFeedback({ kind: 'error', message: `${importErrorMessage(error)}\n现有数据没有发生变化。` });
    }
  }

  async function confirmImport() {
    if (!importCandidate || importing) return;
    setImporting(true);
    let affectedEntries = [] as Awaited<ReturnType<typeof importBackup>>['affectedEntries'];
    let summary = '';
    let projectionWarning = false;
    try {
      if (importCandidate.kind === 'legacy') {
        const result = await importLegacyExport(importCandidate.envelope);
        affectedEntries = result.affectedEntries;
        summary = `导入对话 ${result.conversations} 条、待办 ${result.todos} 条、事件 ${result.events} 个；跳过重复 ${result.duplicates} 条。`;
      } else if (importCandidate.kind === 'v2') {
        const result = await importBackup(importCandidate.envelope);
        affectedEntries = result.affectedEntries;
        const memorySummary = result.memoryAdded + result.memoryUpdated + result.memoryIgnored + result.memoryConflicts > 0
          ? ` 长期记忆：新增 ${result.memoryAdded} 条，更新 ${result.memoryUpdated} 条，保留 ${result.memoryIgnored + result.memoryConflicts} 条。`
          : '';
        summary = `新增 ${result.added} 条，更新 ${result.updated} 条，忽略 ${result.ignored} 条，保留本地冲突 ${result.conflicts} 条。${memorySummary}`;
        try {
          await migrateLegacyEntriesToAssistantHistory();
          await migrateLegacyTopicsToEvents();
        } catch {
          projectionWarning = true;
        }
      } else {
        const result = await importBackupV3(importCandidate.envelope);
        affectedEntries = result.affectedEntries;
        summary = buildBackupV3ResultMessage(result);
      }
    } catch (error) {
      setImportFeedback({ kind: 'error', message: `${importErrorMessage(error)}\n现有数据没有发生变化。` });
      setImporting(false);
      return;
    }

    let notificationWarning = false;
    try {
      await syncEntryReminders(affectedEntries);
      await clearPendingNotificationSync(affectedEntries.map((entry) => entry.id));
    } catch {
      notificationWarning = true;
    }
    try {
      await load();
    } catch {
      // 导入已提交；页面下次聚焦或重启时会重新加载。
    }
    setImportCandidate(null);
    setImportFileName('');
    const warnings = [
      projectionWarning ? '部分历史将在下次启动时继续整理。' : '',
      notificationWarning ? '部分提醒将在下次启动时补建。' : '',
    ].filter(Boolean).join('\n');
    setImportFeedback({
      kind: 'success',
      message: warnings ? `${summary}\n\n${warnings}` : summary,
    });
    setImporting(false);
  }

  const llmStatus = !settings
    ? { label: '读取中', warn: false }
    : !settings.llmEnabled
    ? { label: '已关闭', warn: false }
    : settings.llmKey
      ? { label: '已开启', warn: false }
      : { label: '未配置', warn: true };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MemorySection
          state={memorySectionState({
            loadedOnce: memoryLoadedOnce,
            loading: memoryLoading,
            error: memoryError,
            memoryCount: memories.length,
          })}
          memories={memories}
          summary={memoryLoadedOnce
            ? `${days > 0 ? `陪伴 ${days} 天 · ` : ''}${memories.length} 条`
            : '读取中'}
          busyId={memoryBusyId}
          onRetry={() => void loadMemories()}
          onSave={saveLongTermMemory}
          onForget={forgetLongTermMemory}
        />

        <Text style={styles.sectionTitle}>设置</Text>
        <Text style={styles.sectionLabel}>助手与同步</Text>
        <View style={styles.settingsCard}>
          <Pressable style={styles.settingsRow} onPress={() => router.push('/settings/llm')}>
            <Text style={styles.rowLabel}>理解引擎</Text>
            <Text style={[styles.rowValue, llmStatus.warn && { color: theme.colors.red }]}>
              {llmStatus.label} ›
            </Text>
          </Pressable>
          <CalendarSyncSetting embedded topDividerStyle={styles.dataRowBorder} />
        </View>

        <Text style={styles.sectionLabel}>待办通知</Text>
        <View style={styles.notifyCard}>
          <View style={styles.notifyRow}>
            <Text style={styles.rowLabel}>早 8:00 晨间待办</Text>
            <Switch
              value={profile?.notifyMorning ?? false}
              disabled={!profile}
              onValueChange={(v) => toggleNotify('notifyMorning', v)}
              trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
              thumbColor={profile?.notifyMorning ? theme.colors.accent : '#fff'}
            />
          </View>
          <View style={[styles.notifyRow, styles.dataRowBorder]}>
            <Text style={styles.rowLabel}>晚 21:00 夜间待办</Text>
            <Switch
              value={profile?.notifyEvening ?? false}
              disabled={!profile}
              onValueChange={(v) => toggleNotify('notifyEvening', v)}
              trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
              thumbColor={profile?.notifyEvening ? theme.colors.accent : '#fff'}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>数据管理</Text>
        <View style={styles.dataCard}>
          <Pressable
            style={styles.dataRow}
            onPress={doExport}
          >
            <Text style={styles.rowLabel}>导出完整备份</Text>
            <Text style={styles.rowValue}>Markdown ⤴</Text>
          </Pressable>
          <Pressable style={[styles.dataRow, styles.dataRowBorder]} onPress={chooseImportFile}>
            <Text style={styles.rowLabel}>从备份恢复</Text>
            <Text style={styles.rowValue}>选择备份文件 ›</Text>
          </Pressable>
        </View>

      </ScrollView>
      {memoryUndo && (
        <View style={styles.undoBar}>
          <Text style={styles.undoLabel}>{memoryUndo.label}</Text>
          <Pressable accessibilityRole="button" onPress={() => void undoLastMemoryAction()} style={styles.undoAction}>
            <Text style={styles.undoText}>撤销</Text>
          </Pressable>
        </View>
      )}
      <ImportPreviewModal
        visible={!!importCandidate}
        fileName={importFileName}
        exportedAt={importCandidate?.envelope.exportedAt ?? null}
        preview={importCandidate?.preview ?? null}
        importing={importing}
        onCancel={closeImportPreview}
        onConfirm={confirmImport}
      />
      <ImportFeedbackModal
        kind={importFeedback?.kind ?? null}
        message={importFeedback?.message ?? ''}
        onClose={() => setImportFeedback(null)}
        onRetry={() => {
          setImportFeedback(null);
          void chooseImportFile();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, paddingBottom: 72, gap: 8 },
  sectionTitle: { color: theme.colors.text, fontSize: 19, fontWeight: theme.fontWeight.bold, marginTop: 10 },
  rowLabel: { fontSize: theme.font.body, color: theme.colors.text },
  rowValue: { fontSize: theme.font.small, color: theme.colors.textDim },
  sectionLabel: {
    fontSize: theme.font.small,
    color: theme.colors.textDim,
    marginTop: 2,
    marginLeft: 4,
    marginBottom: -2,
  },
  dataCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    overflow: 'hidden',
  },
  dataRow: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dataRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  settingsCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    overflow: 'hidden',
  },
  settingsRow: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  notifyCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingVertical: 2,
  },
  notifyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: theme.touchTarget,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 14,
    backgroundColor: theme.colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...theme.shadow,
  },
  undoLabel: { color: '#fff', fontSize: theme.font.small },
  undoAction: { minWidth: 58, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: '#F7B58E', fontSize: theme.font.small, fontWeight: '700' },
});
