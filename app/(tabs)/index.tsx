/**
 * 「首页」— 本周待办 + 长期待办 + 主人的备忘录（聚合/用户原声）+ 沉底快速记录
 * 设计依据：DESIGN.md（布局/空态/交互均已对齐）
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Composer } from '../../src/components/Composer';
import { TopicPinIcon } from '../../src/components/TopicPinIcon';
import {
  getSettings,
  listEntries,
  listByKeyword,
  listLongTermTasks,
  listTopicGroups,
  listWeekTasks,
  setDone,
  setParseStatus,
  setTopicPinned,
} from '../../src/db';
import { syncEntryReminder } from '../../src/engine/notifications';
import { ingest, understandEntry } from '../../src/engine/understand';
import { shouldShowUnderstandingFailureBanner } from '../../src/engine/understanding-feedback';
import {
  dateLabel,
  groupWeekTasks,
  isOverdue,
  logTimestamp,
  longTermLabel,
  weekTaskLabel,
  type DayGroup,
} from '../../src/engine/schedule';
import type { Entry, Settings, TopicGroup } from '../../src/types';
import { theme } from '../../src/theme';

type MemoTab = 'aggregate' | 'voice';

export default function HomeScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekGroups, setWeekGroups] = useState<DayGroup[]>([]);
  const [longTerm, setLongTerm] = useState<Entry[]>([]);
  const [memoTab, setMemoTab] = useState<MemoTab>('aggregate');
  const [query, setQuery] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [topics, setTopics] = useState<TopicGroup[]>([]);
  const [stream, setStream] = useState<Entry[]>([]);
  const [voiceLog, setVoiceLog] = useState<Entry[]>([]);
  /** 原声页签实际展示的列表（搜索时为命中子集） */
  const [shownVoice, setShownVoice] = useState<Entry[]>([]);

  const load = useCallback(async () => {
    const [s, week, long_, groups, all] = await Promise.all([
      getSettings(),
      listWeekTasks(),
      listLongTermTasks(),
      listTopicGroups(),
      listEntries({ query: '', kind: 'all', showDone: true }),
    ]);
    setSettings(s);
    setWeekGroups(groupWeekTasks(week));
    setLongTerm(long_);
    setTopics(groups);
    const topicIds = new Set(groups.flatMap((g) => g.entries.map((e) => e.id)));
    setStream(all.filter((e) => !topicIds.has(e.id)));
    setVoiceLog(all);
    setShownVoice(all);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSave(rawText: string, source: 'text' | 'voice') {
    if (!settings) return;
    // 规则结果立即刷新；LLM 精理解落库后再刷一次（onUnderstood 回调）
    await ingest({ rawText, source }, settings, () => { load(); });
    await load();
  }

  async function handleToggle(entry: Entry, done: boolean) {
    await setDone(entry.id, done);
    // 完成即撤到点提醒；取消完成则按剩余时间重挂
    await syncEntryReminder({ ...entry, done: done ? 1 : 0, doneAt: done ? Date.now() : null });
    await load();
  }

  async function handleTopicPin(group: TopicGroup) {
    await setTopicPinned(group.topic, group.pinnedAt === null);
    await load();
  }

  async function handleSearch(q: string) {
    setQuery(q);
    const kw = q.trim();
    if (!kw) {
      load();
      return;
    }
    let list = await listEntries({ query: kw, kind: 'all', showDone: true });
    if (list.length === 0) list = await listByKeyword(kw);
    // 搜索态隐藏主题聚合卡，命中条目统一以时间流卡展示
    setTopics([]);
    setStream(list);
  }

  // 用户原声页签搜索：FTS 命中后按原声列表顺序展示
  async function handleVoiceSearch(q: string) {
    setVoiceQuery(q);
    const kw = q.trim();
    if (!kw) {
      setShownVoice(voiceLog);
      return;
    }
    let hits = await listEntries({ query: kw, kind: 'all', showDone: true });
    if (hits.length === 0) hits = await listByKeyword(kw);
    const hitIds = new Set(hits.map((e) => e.id));
    setShownVoice(voiceLog.filter((e) => hitIds.has(e.id)));
  }

  async function handleUnderstandingRetry(entry: Entry) {
    if (!settings?.llmEnabled || !settings.llmKey) return;
    await setParseStatus(entry.id, 'pending');
    setStream((current) => current.map((item) => (
      item.id === entry.id ? { ...item, parseStatus: 'pending' } : item
    )));
    await understandEntry({ ...entry, parseStatus: 'pending' }, settings);
    await load();
  }

  const understandingFeedbackEnabled = !!settings?.llmEnabled && !!settings.llmKey;
  const showUnderstandingFailureBanner = understandingFeedbackEnabled
    && shouldShowUnderstandingFailureBanner(stream);

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.dateLine}>{dateStr} · 今天</Text>

          {/* 模块一：本周待办 */}
          <Text style={styles.h1}>本周待办</Text>
          {weekGroups.length === 0 ? (
            <View style={styles.emptyWeek}>
              <Ionicons name="calendar-outline" size={22} color={theme.colors.textDim} />
              <Text style={styles.emptyWeekTitle}>这周没有安排，记点什么？</Text>
              <Text style={styles.emptyWeekSub}>说一声「周五还书」，它就出现在这里</Text>
            </View>
          ) : (
            weekGroups.map((g) => (
              <View key={g.dayKey} style={styles.dayGroup}>
                {g.entries.map((e) => (
                  <WeekTaskRow key={e.id} entry={e} isToday={g.isToday} onToggle={handleToggle} />
                ))}
              </View>
            ))
          )}

          {/* 模块二：长期待办（无则隐藏） */}
          {longTerm.length > 0 && (
            <>
              <Text style={styles.h2}>长期待办</Text>
              {longTerm.map((e) => (
                <Pressable
                  key={e.id}
                  style={styles.longRow}
                  onPress={() => router.push(`/entry/${e.id}`)}
                >
                  <Text style={styles.longLabel}>{longTermLabel(e.dueAt!)}</Text>
                  <Text style={styles.longText} numberOfLines={1}>{e.summary}</Text>
                </Pressable>
              ))}
            </>
          )}

          {/* 模块三：主人的备忘录 */}
          <Text style={styles.h1}>主人的备忘录</Text>
          <View style={styles.seg}>
            {(['aggregate', 'voice'] as MemoTab[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setMemoTab(t)}
                style={[styles.segItem, memoTab === t && styles.segItemActive]}
              >
                <Text style={[styles.segText, memoTab === t && styles.segTextActive]}>
                  {t === 'aggregate' ? '聚合消息' : '用户原声'}
                </Text>
              </Pressable>
            ))}
          </View>

          {memoTab === 'aggregate' ? (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={theme.colors.textDim} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={handleSearch}
                  placeholder="搜索记录…"
                  placeholderTextColor={theme.colors.textDim}
                />
              </View>
              {showUnderstandingFailureBanner ? (
                <View style={styles.understandingBanner} accessibilityRole="alert">
                  <Text style={styles.understandingBannerText}>多条消息暂未整理，原文均已安全保存</Text>
                  <Pressable
                    onPress={() => router.push('/settings/llm')}
                    accessibilityRole="button"
                    accessibilityLabel="检查理解引擎设置"
                  >
                    <Text style={styles.understandingAction}>检查设置</Text>
                  </Pressable>
                </View>
              ) : null}
              {topics.length === 0 && stream.length === 0 ? (
                <Text style={styles.empty}>
                  {query.trim() ? '没有匹配的记录。' : '第一条记录，从下面那句话开始。'}
                </Text>
              ) : (
                <>
                  {topics.map((g) => (
                    <View key={g.topic} style={[styles.topicCard, g.pinnedAt !== null && styles.topicCardPinned]}>
                      <View style={styles.topicHead}>
                        <Pressable
                          style={styles.topicTitleTap}
                          onPress={() => router.push(`/topic/${encodeURIComponent(g.topic)}`)}
                        >
                          <Text style={styles.topicName}>#{g.topic}</Text>
                        </Pressable>
                        <Text style={styles.topicCount}>{g.entries.length} 条</Text>
                      </View>
                      <Pressable
                        style={styles.pinButton}
                        accessibilityRole="button"
                        accessibilityState={{ selected: g.pinnedAt !== null }}
                        accessibilityLabel={g.pinnedAt !== null ? `取消置顶${g.topic}` : `置顶${g.topic}`}
                        onPress={() => handleTopicPin(g)}
                      >
                        <TopicPinIcon pinned={g.pinnedAt !== null} />
                      </Pressable>
                      <Pressable onPress={() => router.push(`/topic/${encodeURIComponent(g.topic)}`)}>
                        <Text style={styles.topicSummary} numberOfLines={2}>{g.latest.summary}</Text>
                        <Text style={styles.topicTime}>{logTimestamp(g.latest.updatedAt)}</Text>
                      </Pressable>
                    </View>
                  ))}
                  {stream.map((e) => (
                    <View key={e.id} style={styles.streamCard}>
                      <Pressable onPress={() => router.push(`/entry/${e.id}`)}>
                        <Text style={styles.tsMono}>{logTimestamp(e.updatedAt)}</Text>
                        <Text style={styles.streamText} numberOfLines={2}>{e.summary}</Text>
                      </Pressable>
                      {understandingFeedbackEnabled && e.parseStatus === 'pending' ? (
                        <View style={styles.understandingStatus} accessibilityLiveRegion="polite">
                          <ActivityIndicator size="small" color={theme.colors.textDim} />
                          <Text style={styles.processingText}>正在整理…</Text>
                        </View>
                      ) : null}
                      {understandingFeedbackEnabled && e.parseStatus === 'failed' ? (
                        <View style={styles.understandingStatus} accessibilityLiveRegion="polite">
                          <View style={styles.failureDot} />
                          <Text style={styles.failureText}>原文已保存，暂未整理</Text>
                          <Pressable
                            style={styles.retryButton}
                            onPress={() => { void handleUnderstandingRetry(e); }}
                            accessibilityRole="button"
                            accessibilityLabel="重新整理这条消息"
                          >
                            <Text style={styles.understandingAction}>重试</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={theme.colors.textDim} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={voiceQuery}
                  onChangeText={handleVoiceSearch}
                  placeholder="搜索原声…"
                  placeholderTextColor={theme.colors.textDim}
                />
              </View>
              {shownVoice.length === 0 ? (
                <Text style={styles.empty}>
                  {voiceQuery.trim() ? '没有匹配的原声。' : '第一条记录，从下面那句话开始。'}
                </Text>
              ) : (
                shownVoice.map((e) => (
                  <Pressable key={e.id} style={styles.streamCard} onPress={() => router.push(`/entry/${e.id}`)}>
                    <Text style={styles.tsMono}>{logTimestamp(e.updatedAt)}</Text>
                    <Text style={styles.voiceText}>{e.rawText}</Text>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>

        {/* 沉底 Composer */}
        <View style={styles.composerBar}>
          <Composer onSave={handleSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** 本周待办行：勾选框 + 日期/星期/时间 + 概要（逾期置顶警示、完成划线） */
function WeekTaskRow({
  entry,
  isToday,
  onToggle,
}: {
  entry: Entry;
  isToday: boolean;
  onToggle: (entry: Entry, done: boolean) => void;
}) {
  const done = !!entry.done;
  const overdue = isOverdue(entry);
  return (
    <View style={[styles.weekRow, isToday && !done && styles.weekRowToday, done && { opacity: 0.55 }]}>
      <Pressable onPress={() => onToggle(entry, !done)} style={[styles.check, done && styles.checkOn]} hitSlop={8}>
        {done && <Ionicons name="checkmark" size={13} color="#fff" />}
      </Pressable>
      <Text style={[styles.weekLabel, overdue && { color: theme.colors.red }]}>
        {overdue ? '已逾期' : weekTaskLabel(entry.dueAt, Date.now())}
      </Text>
      <Text style={[styles.weekText, done && styles.weekTextDone]} numberOfLines={2}>
        {entry.summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 16, gap: 10 },
  dateLine: { fontSize: theme.font.small, color: theme.colors.textDim },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  h2: { fontSize: 14, fontWeight: '700', color: theme.colors.textDim, marginTop: 8 },
  emptyWeek: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.textDim,
    borderRadius: theme.radius.input,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyWeekTitle: { fontSize: theme.font.body, color: theme.colors.textDim },
  emptyWeekSub: { fontSize: theme.font.small, color: theme.colors.textDim },
  dayGroup: { gap: 8 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  weekRowToday: { backgroundColor: theme.colors.goldSoft, borderColor: theme.colors.gold },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.colors.green, borderColor: theme.colors.green },
  weekLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.colors.accent, minWidth: 48 },
  weekText: { flex: 1, fontSize: theme.font.body, color: theme.colors.text },
  weekTextDone: { textDecorationLine: 'line-through', color: theme.colors.textDim },
  longRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  longLabel: { fontSize: theme.font.small, fontWeight: '700', color: theme.colors.textDim },
  longText: { flex: 1, fontSize: theme.font.body, color: theme.colors.text },
  seg: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segItem: { flex: 1, paddingVertical: 6, borderRadius: theme.radius.pill, alignItems: 'center' },
  segItemActive: { backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.border },
  segText: { fontSize: theme.font.small, color: theme.colors.textDim, fontWeight: '600' },
  segTextActive: { color: theme.colors.text },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchIcon: { marginTop: 0 },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: theme.font.body,
    color: theme.colors.text,
  },
  empty: { fontSize: theme.font.body, color: theme.colors.textDim, paddingVertical: 24, textAlign: 'center' },
  topicCard: {
    position: 'relative',
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 4,
  },
  topicCardPinned: { borderColor: theme.colors.gold, backgroundColor: theme.colors.goldSoft },
  topicHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingRight: 32 },
  topicTitleTap: { flex: 1, paddingVertical: 2 },
  pinButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  topicName: { fontSize: theme.font.body, fontWeight: '700', color: theme.colors.gold },
  topicCount: { fontSize: theme.font.small, color: theme.colors.textDim },
  topicSummary: { fontSize: theme.font.body, color: theme.colors.text },
  topicTime: { fontSize: theme.font.small, color: theme.colors.textDim },
  streamCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 3,
  },
  understandingBanner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.accentSoft,
  },
  understandingBannerText: { flex: 1, fontSize: 12, lineHeight: 17, color: theme.colors.red },
  understandingStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28, marginTop: 3 },
  processingText: { fontSize: 12, color: theme.colors.textDim },
  failureDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.red },
  failureText: { flex: 1, fontSize: 12, color: theme.colors.red },
  retryButton: { minWidth: 44, minHeight: 28, alignItems: 'flex-end', justifyContent: 'center' },
  understandingAction: { fontSize: 12, fontWeight: '600', color: theme.colors.accent },
  tsMono: { fontSize: 12, color: theme.colors.textDim, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  streamText: { fontSize: theme.font.body, color: theme.colors.text },
  voiceText: { fontSize: theme.font.body, color: theme.colors.text, lineHeight: 22 },
  composerBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: theme.colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
