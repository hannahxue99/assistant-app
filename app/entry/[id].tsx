/**
 * 用户原声详情页 — 参考 iOS 备忘录（Apple Notes）交互模式：
 * - 浏览态点击标题或正文进入编辑；不显示铅笔
 * - 编辑态右上显示「完成」保存；无改动点完成=直接退出
 * - 删除 = 正文下方居中小字链接（仍二次确认）
 * - 编辑经 applyCorrection 落库（快照入 correctedFrom）；topic 不动 → 聚合归属不变
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { EditAction } from '../../src/components/EditAction';
import { applyCorrection, deleteEntry, getEntry } from '../../src/db';
import {
  cancelEntryReminder,
  refreshTaskDrivenNotifications,
  syncEntryReminder,
} from '../../src/engine/notifications';
import { logTimestamp } from '../../src/engine/schedule';
import { wasEntryEdited } from '../../src/engine/entry-time';
import {
  analyzeEntryDateEdit,
  formatEditDate,
  normalizeEntryDateTexts,
} from '../../src/engine/edit-date-decision';
import type { Entry } from '../../src/types';
import { theme } from '../../src/theme';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const twoParts = !!entry && entry.rawText.trim() !== entry.summary.trim();
  const dirty = editing && !!entry
    && draftTitle.trim() !== ''
    && draftBody.trim() !== ''
    && (draftTitle.trim() !== entry.summary.trim() || draftBody.trim() !== entry.rawText.trim());

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const e = await getEntry(id);
        if (!e) {
          router.back();
          return;
        }
        setEntry(e);
      })();
    }, [id]),
  );

  function handleBack() {
    if (dirty) {
      Alert.alert('改动未保存', '丢弃当前修改吗？', [
        { text: '继续编辑', style: 'cancel' },
        { text: '丢弃', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  }

  function startEdit() {
    if (!entry) return;
    setDraftTitle(entry.summary);
    setDraftBody(entry.rawText);
    setEditing(true);
  }

  async function commitSave(title: string, body: string, dueAt: number | null) {
    if (!entry || saving) return;
    setSaving(true);
    try {
      const updated = await applyCorrection(entry.id, {
        summary: title,
        rawText: body,
        dueAt,
      });
      setEditing(false);
      if (updated) {
        setEntry(updated);
        await syncEntryReminder(updated);
      }
    } catch {
      Alert.alert('保存失败', '修改尚未保存，请重试。');
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!entry || saving) return;
    if (!dirty) {
      setEditing(false); // 无改动：直接退出编辑态
      return;
    }
    const title = draftTitle.trim();
    const body = draftBody.trim();
    const decision = analyzeEntryDateEdit(entry, title, body, Date.now());

    if (decision.kind === 'direct') {
      const normalized = decision.dueAt == null
        ? { title, body }
        : normalizeEntryDateTexts(title, body, decision.dueAt);
      void commitSave(normalized.title, normalized.body, decision.dueAt);
      return;
    }
    if (decision.kind === 'ambiguous') {
      const label = decision.field === 'both' ? '标题和正文' : decision.field === 'title' ? '标题' : '正文';
      Alert.alert('检测到多个日期', `${label}里有多个不同日期。请保留一个待办日期后再完成编辑。`, [
        { text: '继续编辑', style: 'cancel' },
      ]);
      return;
    }
    if (decision.kind === 'confirm-clear') {
      const current = formatEditDate(entry.dueAt);
      Alert.alert('未检测到日期', `标题和正文里已没有日期，是否清除原待办日期 ${current}？`, [
        { text: '继续编辑', style: 'cancel' },
        {
          text: `保留${current}`,
          onPress: () => {
            const normalized = normalizeEntryDateTexts(title, body, entry.dueAt!);
            void commitSave(normalized.title, normalized.body, entry.dueAt);
          },
        },
        { text: '清除待办日期', onPress: () => void commitSave(title, body, null) },
      ]);
      return;
    }
    if (decision.kind === 'confirm-change') {
      const detected = formatEditDate(decision.dueAt);
      const message = entry.dueAt == null
        ? `检测到新的日期 ${detected}。确认后，标题、正文和待办将统一使用该日期。`
        : `检测到日期从 ${formatEditDate(entry.dueAt)} 变为 ${detected}。确认后，标题、正文和待办将统一更新。`;
      Alert.alert('统一待办日期', message, [
        { text: '继续编辑', style: 'cancel' },
        {
          text: `统一为${detected}`,
          onPress: () => {
            const normalized = normalizeEntryDateTexts(title, body, decision.dueAt);
            setDraftTitle(normalized.title);
            setDraftBody(normalized.body);
            void commitSave(normalized.title, normalized.body, decision.dueAt);
          },
        },
      ]);
      return;
    }

    const titleDate = formatEditDate(decision.title.dueAt);
    const bodyDate = formatEditDate(decision.body.dueAt);
    Alert.alert('日期不一致', `标题中的日期是 ${titleDate}，正文中的日期是 ${bodyDate}。请选择待办日期。`, [
      { text: '继续编辑', style: 'cancel' },
      {
        text: `统一为${titleDate}`,
        onPress: () => {
          const normalized = normalizeEntryDateTexts(title, body, decision.title.dueAt);
          setDraftTitle(normalized.title);
          setDraftBody(normalized.body);
          void commitSave(normalized.title, normalized.body, decision.title.dueAt);
        },
      },
      {
        text: `统一为${bodyDate}`,
        onPress: () => {
          const normalized = normalizeEntryDateTexts(title, body, decision.body.dueAt);
          setDraftTitle(normalized.title);
          setDraftBody(normalized.body);
          void commitSave(normalized.title, normalized.body, decision.body.dueAt);
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert('删除这条记录', '删除后不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteEntry(id);
          await cancelEntryReminder(id);
          await refreshTaskDrivenNotifications();
          router.back();
        },
      },
    ]);
  }

  const showBody = twoParts;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Text style={styles.back}>‹ 用户原声</Text>
        </Pressable>
        {editing && <EditAction editing onPress={handleSave} label="编辑用户原声" />}
      </View>
      {entry && (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.timestamps}>
            <Text style={styles.ts}>创建 {logTimestamp(entry.createdAt)}</Text>
            {wasEntryEdited(entry) && (
              <Text style={styles.ts}>编辑 {logTimestamp(entry.updatedAt)}</Text>
            )}
          </View>
          {editing ? (
            <>
              <TextInput
                style={styles.titleInput}
                value={draftTitle}
                onChangeText={setDraftTitle}
                multiline
                autoFocus
                maxLength={500}
                placeholder="标题"
                placeholderTextColor={theme.colors.textDim}
              />
              <TextInput
                style={styles.bodyInput}
                value={draftBody}
                onChangeText={setDraftBody}
                multiline
                maxLength={500}
                placeholder="内容"
                placeholderTextColor={theme.colors.textDim}
              />
            </>
          ) : (
            <Pressable
              style={styles.browseEditArea}
              onPress={startEdit}
              accessibilityRole="button"
              accessibilityLabel="编辑标题和内容"
            >
              <Text style={styles.title}>{entry.summary}</Text>
              {showBody && (
                <Text style={styles.body}>{entry.rawText}</Text>
              )}
            </Pressable>
          )}
          {!editing && (
            <Pressable style={styles.deleteLink} onPress={confirmDelete}>
              <Text style={styles.deleteLinkText}>删除这条记录</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, gap: 12, flexGrow: 1 },
  timestamps: { gap: 4 },
  ts: { fontSize: 13, color: theme.colors.textDim, fontFamily: 'Menlo' },
  browseEditArea: { flex: 1, gap: 12 },
  title: { fontSize: 18, fontWeight: '600', color: theme.colors.text, lineHeight: 26 },
  body: { fontSize: 16, color: theme.colors.textDim, lineHeight: 26 },
  deleteLink: { marginTop: 'auto', paddingTop: 48, paddingBottom: 24, alignItems: 'center' },
  deleteLinkText: { fontSize: theme.font.small, color: theme.colors.red },
  titleInput: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    lineHeight: 26,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  bodyInput: {
    fontSize: 16,
    color: theme.colors.textDim,
    lineHeight: 26,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
});
