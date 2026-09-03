/**
 * 主题详情页 — #主题+条数 / 卡片流（点击进用户原声详情页编辑）
 *
 * 交互规则（2026-09-01 二次改版，用户决策）：
 * - 所有卡片点击 → 跳转该条的用户原声详情页（编辑在那里完成，返回时本页重载见新内容）
 * - 底部按钮栏已删除
 */
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listByTopic, renameTopic } from '../../src/db';
import { logTimestamp } from '../../src/engine/schedule';
import type { Entry } from '../../src/types';
import { theme } from '../../src/theme';

export default function TopicDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const routeTopic = decodeURIComponent(name ?? '');
  const router = useRouter();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [topic, setTopic] = useState(routeTopic);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState(routeTopic);

  const load = useCallback(async () => {
    const list = await listByTopic(topic);
    setEntries(list);
  }, [topic]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function handleBack() {
    router.back();
  }

  function startTopicEdit() {
    setTopicDraft(topic);
    setEditingTopic(true);
  }

  async function applyTopicRename(nextTopic: string) {
    await renameTopic(topic, nextTopic);
    setTopic(nextTopic);
    setTopicDraft(nextTopic);
    setEditingTopic(false);
    router.replace(`/topic/${encodeURIComponent(nextTopic)}` as any);
  }

  async function saveTopic() {
    const nextTopic = topicDraft.trim().replace(/^#+\s*/, '');
    if (!nextTopic) {
      Alert.alert('主题不能为空', '请输入一个主题名称。');
      return;
    }
    if (nextTopic === topic) {
      setEditingTopic(false);
      return;
    }

    const targetEntries = await listByTopic(nextTopic);
    if (targetEntries.length > 0) {
      Alert.alert(
        '合并聚合消息？',
        `“${nextTopic}”已经存在，修改后两组消息会合并。`,
        [
          { text: '取消', style: 'cancel' },
          { text: '合并', onPress: () => { void applyTopicRename(nextTopic); } },
        ],
      );
      return;
    }
    await applyTopicRename(nextTopic);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Text style={styles.back}>‹ 聚合消息</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          {editingTopic ? (
            <View style={styles.topicEditRow}>
              <Text style={styles.hash}>#</Text>
              <TextInput
                value={topicDraft}
                onChangeText={setTopicDraft}
                autoFocus
                maxLength={40}
                returnKeyType="done"
                onSubmitEditing={saveTopic}
                style={styles.topicInput}
                selectionColor={theme.colors.accent}
              />
              <Pressable hitSlop={8} onPress={() => setEditingTopic(false)}>
                <Text style={styles.cancel}>取消</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={saveTopic}>
                <Text style={styles.done}>完成</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.topicTitleRow}>
              <Text style={styles.topic}>#{topic}</Text>
              <Pressable
                style={styles.editTopicButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="修改主题"
                onPress={startTopicEdit}
              >
                <Ionicons name="pencil-outline" size={17} color={theme.colors.accent} />
              </Pressable>
            </View>
          )}
          <Text style={styles.count}>{entries.length} 条</Text>
        </View>

        {entries.map((e) => (
          <Pressable
            key={e.id}
            style={styles.card}
            onPress={() => router.push(`/entry/${e.id}`)}
          >
            <Text style={styles.historyText}>{e.summary}</Text>
            {e.rawText.trim() !== e.summary.trim() && (
              <Text style={styles.rawText}>{e.rawText}</Text>
            )}
            <Text style={styles.ts}>{logTimestamp(e.createdAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { paddingHorizontal: 16, paddingVertical: 8 },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, gap: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  topicTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  editTopicButton: { padding: 3 },
  topicEditRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  hash: { fontSize: 18, fontWeight: '700', color: theme.colors.gold },
  topicInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.text,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.accent,
    paddingVertical: 4,
  },
  cancel: { fontSize: theme.font.small, color: theme.colors.textDim },
  done: { fontSize: theme.font.small, fontWeight: '700', color: theme.colors.accent },
  topic: { fontSize: 18, fontWeight: '700', color: theme.colors.gold },
  count: { fontSize: theme.font.small, color: theme.colors.textDim },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  historyText: { fontSize: theme.font.body, color: theme.colors.text, lineHeight: 22 },
  rawText: { fontSize: theme.font.small, color: theme.colors.textDim, lineHeight: 20 },
  ts: { fontSize: 12, color: theme.colors.textDim, fontFamily: 'Menlo', marginTop: 2 },
});
