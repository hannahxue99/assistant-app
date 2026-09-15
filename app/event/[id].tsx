import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AssistantEventDetail } from '../../src/assistant/action-types';
import { getEventDetail, renameEvent, setEventPinned } from '../../src/assistant/event-store';
import { getEntry, setDone } from '../../src/db';
import { syncEntryReminder } from '../../src/engine/notifications';
import { logTimestamp } from '../../src/engine/schedule';
import { theme } from '../../src/theme';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<AssistantEventDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadState(current => current === 'ready' ? current : 'loading');
    try {
      const value = await getEventDetail(id);
      setDetail(value);
      setLoadState(value ? 'ready' : 'missing');
    } catch {
      setLoadState('error');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function togglePin() {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await setEventPinned({
        eventId: detail.event.id,
        pinned: detail.event.pinnedAt === null,
        expectedRevision: detail.event.revision,
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  function openMore() {
    if (!detail) return;
    Alert.alert(detail.event.title, undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '重命名',
        onPress: () => {
          setTitleDraft(detail.event.title);
          setEditingTitle(true);
        },
      },
    ]);
  }

  async function saveTitle() {
    if (!detail || saving) return;
    const title = titleDraft.trim();
    if (!title) {
      Alert.alert('标题不能为空', '请输入事件名称。');
      return;
    }
    setSaving(true);
    try {
      const renamed = await renameEvent({
        eventId: detail.event.id,
        title,
        expectedRevision: detail.event.revision,
      });
      if (!renamed) Alert.alert('没有保存', '事件刚刚有了新变化，请刷新后再试。');
      else setEditingTitle(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleTodo(todoId: string, done: boolean) {
    await setDone(todoId, done);
    const next = await getEventDetail(id);
    const todo = next?.todos.find(item => item.id === todoId);
    if (todo) {
      const entry = await getEntry(todo.id);
      if (entry) await syncEntryReminder(entry);
    }
    setDetail(next);
  }

  function talkToXiaozhi() {
    if (!detail) return;
    router.push({
      pathname: '/assistant',
      params: {
        contextKind: 'event',
        contextId: detail.event.id,
        contextLabel: detail.event.title,
        contextState: detail.event.currentState,
      },
    } as never);
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        {detail ? (
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={detail.event.pinnedAt ? '取消置顶事件' : '置顶事件'} onPress={togglePin} style={styles.iconButton}>
              <Ionicons name={detail.event.pinnedAt ? 'pin' : 'pin-outline'} size={20} color={detail.event.pinnedAt ? theme.colors.gold : theme.colors.textDim} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="更多事件操作" onPress={openMore} style={styles.iconButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {loadState === 'loading' ? (
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /></View>
      ) : loadState === 'missing' ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>这条事件不存在</Text>
          <Pressable onPress={() => router.back()} style={styles.retryButton}><Text style={styles.retryText}>返回</Text></Pressable>
        </View>
      ) : loadState === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>事件暂时加载不了</Text>
          <Pressable onPress={() => { void load(); }} style={styles.retryButton}><Text style={styles.retryText}>重试</Text></Pressable>
        </View>
      ) : detail ? (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.updated}>更新于 {logTimestamp(detail.event.updatedAt)}</Text>
            {editingTitle ? (
              <View style={styles.titleEditRow}>
                <TextInput
                  autoFocus
                  maxLength={120}
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                  onSubmitEditing={() => { void saveTitle(); }}
                  style={styles.titleInput}
                />
                <Pressable onPress={() => { void saveTitle(); }} style={styles.saveButton}>
                  <Text style={styles.saveText}>{saving ? '保存中…' : '保存'}</Text>
                </Pressable>
              </View>
            ) : <Text style={styles.title}>{detail.event.title}</Text>}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>当前状态</Text>
              <Text style={styles.currentState}>{detail.event.currentState || '暂时还没有明确状态'}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>相关待办</Text>
              {detail.todos.length === 0 ? <Text style={styles.empty}>还没有相关待办</Text> : detail.todos.map(todo => (
                <View key={todo.id} style={styles.todoRow}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: todo.done }}
                    onPress={() => { void toggleTodo(todo.id, !todo.done); }}
                    style={[styles.checkbox, todo.done && styles.checkboxDone]}
                  >
                    {todo.done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                  </Pressable>
                  <Pressable style={styles.todoTextTap} onPress={() => router.push(`/entry/${todo.id}`)}>
                    <Text style={[styles.todoText, todo.done && styles.todoDone]}>{todo.text}</Text>
                    <Text style={styles.todoDate}>{todo.dueAt ? logTimestamp(todo.dueAt) : '尚未确定时间'}</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>关键进展</Text>
              {detail.updates.length === 0 ? <Text style={styles.empty}>还没有关键进展</Text> : detail.updates.map(update => (
                <View key={update.id} style={styles.progressRow}>
                  <View style={styles.progressDot} />
                  <View style={styles.progressContent}>
                    <Text style={styles.progressText}>{update.content}</Text>
                    <Text style={styles.progressTime}>{logTimestamp(update.occurredAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={styles.bottomBar}>
            <Pressable accessibilityRole="button" onPress={talkToXiaozhi} style={({ pressed }) => [styles.talkButton, pressed && styles.pressed]}>
              <Ionicons name="chatbubble-ellipses-outline" size={19} color="#FFFFFF" />
              <Text style={styles.talkText}>和小知聊这件事</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { minHeight: 54, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row' },
  iconButton: { width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  errorTitle: { color: theme.colors.text, fontSize: theme.font.heading, fontWeight: theme.fontWeight.semibold },
  retryButton: { minWidth: 88, minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: theme.colors.accent, fontSize: theme.font.body },
  content: { paddingHorizontal: theme.spacing.md, paddingBottom: 30, gap: 18 },
  updated: { color: theme.colors.textDim, fontSize: 12 },
  title: { color: theme.colors.text, fontSize: 25, lineHeight: 34, fontWeight: theme.fontWeight.bold },
  titleEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleInput: { flex: 1, color: theme.colors.text, fontSize: 23, fontWeight: theme.fontWeight.bold, borderBottomWidth: 1, borderBottomColor: theme.colors.accent, paddingVertical: 5 },
  saveButton: { minWidth: 58, minHeight: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  section: { gap: 9 },
  sectionLabel: { color: theme.colors.textDim, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  currentState: { color: theme.colors.text, fontSize: 17, lineHeight: 26, padding: 14, borderRadius: theme.radius.card, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  empty: { color: theme.colors.textDim, fontSize: theme.font.small, paddingVertical: 8 },
  todoRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, borderRadius: theme.radius.input, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: theme.colors.textDim, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { borderColor: theme.colors.green, backgroundColor: theme.colors.green },
  todoTextTap: { flex: 1, minHeight: 54, justifyContent: 'center', paddingVertical: 7 },
  todoText: { color: theme.colors.text, fontSize: theme.font.body },
  todoDone: { color: theme.colors.textDim, textDecorationLine: 'line-through' },
  todoDate: { color: theme.colors.textDim, fontSize: 11, marginTop: 3 },
  progressRow: { flexDirection: 'row', gap: 10, paddingVertical: 5 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent, marginTop: 7 },
  progressContent: { flex: 1, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  progressText: { color: theme.colors.text, fontSize: theme.font.body, lineHeight: 22 },
  progressTime: { color: theme.colors.textDim, fontSize: 11, marginTop: 4 },
  bottomBar: { paddingHorizontal: theme.spacing.md, paddingTop: 9, paddingBottom: 5, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg },
  talkButton: { minHeight: 50, borderRadius: 15, backgroundColor: theme.colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  talkText: { color: '#FFFFFF', fontSize: theme.font.body, fontWeight: theme.fontWeight.semibold },
  pressed: { opacity: 0.72 },
});
