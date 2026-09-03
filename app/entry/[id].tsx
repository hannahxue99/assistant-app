/**
 * 用户原声详情页 — 参考 iOS 备忘录（Apple Notes）交互模式：
 * - 顶部导航行：‹ 返回 ｜ 右上 ✏️ 手动编辑
 * - 点击进手动编辑（只有标题+原文输入框）→「完成」保存；无改动点完成=直接退出
 * - 删除 = 正文下方居中小字链接（仍二次确认）
 * - 编辑经 applyCorrection 落库（快照入 correctedFrom）；topic 不动 → 聚合归属不变
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { applyCorrection, deleteEntry, getEntry } from '../../src/db';
import {
  cancelEntryReminder,
  refreshTaskDrivenNotifications,
  syncEntryReminder,
} from '../../src/engine/notifications';
import { logTimestamp } from '../../src/engine/schedule';
import type { Entry } from '../../src/types';
import { theme } from '../../src/theme';

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const twoParts = !!entry && entry.rawText.trim() !== entry.summary.trim();
  const dirty = editing && !!entry
    && draftTitle.trim() !== ''
    && (!twoParts || draftBody.trim() !== '')
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

  function setText(v: string) {
    setDraftTitle(v);
    if (!twoParts) setDraftBody(v);
  }

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

  async function handleSave() {
    if (!entry) return;
    if (!dirty) {
      setEditing(false); // 无改动：直接退出编辑态
      return;
    }
    const updated = await applyCorrection(entry.id, {
      summary: draftTitle.trim(),
      rawText: twoParts ? draftBody.trim() : draftTitle.trim(),
    });
    setEditing(false);
    if (updated) {
      setEntry(updated);
      await syncEntryReminder(updated);
    }
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
        {editing ? (
          <Pressable onPress={handleSave} hitSlop={8}>
            <Text style={styles.doneBtn}>完成</Text>
          </Pressable>
        ) : (
          <Pressable onPress={startEdit} hitSlop={8} style={styles.iconBtn}>
            <Ionicons name="pencil-outline" size={20} color={theme.colors.accent} />
          </Pressable>
        )}
      </View>
      {entry && (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.ts}>{logTimestamp(entry.createdAt)}</Text>
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
              {twoParts && (
                <TextInput
                  style={styles.bodyInput}
                  value={draftBody}
                  onChangeText={setDraftBody}
                  multiline
                  maxLength={500}
                />
              )}
            </>
          ) : (
            <>
              <Text style={styles.title}>{entry.summary}</Text>
              {showBody && <Text style={styles.body}>{entry.rawText}</Text>}
            </>
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
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: { fontSize: theme.font.body, color: theme.colors.accent, fontWeight: '600' },
  doneBtnDisabled: { color: theme.colors.textDim },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, gap: 12, flexGrow: 1 },
  ts: { fontSize: 13, color: theme.colors.textDim, fontFamily: 'Menlo' },
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
