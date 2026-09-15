/**
 * 「首页」— 本周待办 + 持续事件 + 主人的备忘录（聚合/用户原声）+ 沉底快速记录
 * 设计依据：DESIGN.md（布局/空态/交互均已对齐）
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useRef } from 'react';
import { subscribeEntryChanges } from '../../src/engine/entry-events';
import {
  ActivityIndicator,
  Alert,
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
import { AssistantEventCard } from '../../src/components/AssistantEventCard';
import { TopicPinIcon } from '../../src/components/TopicPinIcon';
import {
  getSettings,
  listEntries,
  listByKeyword,
  listTopicGroups,
  listLongTermTasks,
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
  weekTaskLabel,
  type DayGroup,
} from '../../src/engine/schedule';
import type { Entry, Settings, TopicGroup } from '../../src/types';
import type { AssistantEvent } from '../../src/assistant/action-types';
import { listEvents, setEventPinned } from '../../src/assistant/event-store';
import { theme } from '../../src/theme';

type MemoTab = 'aggregate' | 'voice';
type TodoView = 'week' | 'all';

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ todoView?: string; focusTodoId?: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weekGroups, setWeekGroups] = useState<DayGroup[]>([]);
  const [longTermGroups, setLongTermGroups] = useState<DayGroup[]>([]);
  const [todosState, setTodosState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [todoView, setTodoView] = useState<TodoView>('week');
  const [highlightedTodoId, setHighlightedTodoId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const todoSectionY = useRef<number | null>(null);
  const todoRowY = useRef(new Map<string, number>());
  const pendingFocusTodoId = useRef<string | null>(null);
  const lastFocusIntent = useRef('');
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [events, setEvents] = useState<AssistantEvent[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pinningEventId, setPinningEventId] = useState<string | null>(null);
  const [memoTab, setMemoTab] = useState<MemoTab>('aggregate');
  const [query, setQuery] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const filters = useRef({ query: '', voiceQuery: '' });
  const loadVersion = useRef(0);
  const [topics, setTopics] = useState<TopicGroup[]>([]);
  const [stream, setStream] = useState<Entry[]>([]);
  const [voiceLog, setVoiceLog] = useState<Entry[]>([]);
  /** 原声页签实际展示的列表（搜索时为命中子集） */
  const [shownVoice, setShownVoice] = useState<Entry[]>([]);

  const loadEvents = useCallback(async (version = loadVersion.current) => {
    setEventsState('loading');
    try {
      const value = await listEvents({ status: 'active', limit: 20 });
      if (version !== loadVersion.current) return;
      setEvents(value);
      setEventsState('ready');
    } catch {
      if (version !== loadVersion.current) return;
      setEventsState('error');
    }
  }, []);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const activeFilters = { ...filters.current };
    void loadEvents(version);
    setTodosState(current => current === 'ready' ? current : 'loading');
    const [s, todoLists, groups, all] = await Promise.all([
      getSettings(),
      Promise.all([listWeekTasks(), listLongTermTasks()])
        .then(([week, longTerm]) => ({ week, longTerm, failed: false as const }))
        .catch(() => ({ week: [] as Entry[], longTerm: [] as Entry[], failed: true as const })),
      listTopicGroups(),
      listEntries({ query: '', kind: 'all', showDone: true }),
    ]);
    async function search(text: string) {
      const keyword = text.trim();
      if (!keyword) return null;
      const hits = await listEntries({ query: keyword, kind: 'all', showDone: true });
      return hits.length ? hits : listByKeyword(keyword);
    }
    const [aggregateHits, voiceHits] = await Promise.all([
      search(activeFilters.query), search(activeFilters.voiceQuery),
    ]);
    if (version !== loadVersion.current) return;
    setSettings(s);
    if (todoLists.failed) setTodosState('error');
    else {
      setWeekGroups(groupWeekTasks(todoLists.week));
      setLongTermGroups(groupWeekTasks(todoLists.longTerm));
      setTodosState('ready');
    }
    setTopics(aggregateHits ? [] : groups);
    setStream(aggregateHits ?? all.filter((e) => !e.topic));
    setVoiceLog(all);
    setShownVoice(voiceHits ?? all);
  }, [loadEvents]);

  const tryFocusTodo = useCallback(() => {
    const todoId = pendingFocusTodoId.current;
    const sectionY = todoSectionY.current;
    const rowY = todoId ? todoRowY.current.get(`${todoView}:${todoId}`) : undefined;
    if (!todoId || sectionY === null || rowY === undefined) return;
    pendingFocusTodoId.current = null;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, sectionY + rowY - 16), animated: true }));
  }, [todoView]);

  useEffect(() => {
    const nextView = params.todoView === 'all' ? 'all' : params.todoView === 'week' ? 'week' : null;
    if (nextView) setTodoView(nextView);
    const focusTodoId = typeof params.focusTodoId === 'string' ? params.focusTodoId : null;
    if (!nextView || !focusTodoId) return;
    const intent = `${nextView}:${focusTodoId}`;
    if (lastFocusIntent.current === intent) return;
    lastFocusIntent.current = intent;
    pendingFocusTodoId.current = focusTodoId;
    setHighlightedTodoId(focusTodoId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedTodoId(null), 1800);
    requestAnimationFrame(tryFocusTodo);
  }, [params.focusTodoId, params.todoView, tryFocusTodo]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const refresh = () => { void load().catch(() => console.warn('记录刷新失败')); };
      refresh();
      const unsubscribe = subscribeEntryChanges(refresh);
      return () => { unsubscribe(); loadVersion.current++; };
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

  async function handleEventPin(event: AssistantEvent) {
    if (pinningEventId) return;
    setPinningEventId(event.id);
    try {
      const updated = await setEventPinned({
        eventId: event.id,
        pinned: event.pinnedAt === null,
        expectedRevision: event.revision,
      });
      if (!updated) Alert.alert('没有保存', '事件刚刚有了新变化，请刷新后再试。');
      await loadEvents();
    } catch {
      Alert.alert('置顶没有保存', '请稍后再试。');
    } finally {
      setPinningEventId(null);
    }
  }

  async function handleSearch(q: string) {
    setQuery(q);
    filters.current.query = q;
    await load().catch(() => console.warn('搜索失败'));
  }

  // 用户原声页签搜索：FTS 命中后按原声列表顺序展示
  async function handleVoiceSearch(q: string) {
    setVoiceQuery(q);
    filters.current.voiceQuery = q;
    await load().catch(() => console.warn('搜索失败'));
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
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.dateLine}>{dateStr} · 今天</Text>

          {/* 模块一：同一位置切换 7 天窗口和更远待办，两个列表互不重复。 */}
          <View
            style={styles.todoSection}
            onLayout={event => {
              todoSectionY.current = event.nativeEvent.layout.y;
              tryFocusTodo();
            }}
          >
            <View style={styles.todoTabs}>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: todoView === 'week' }}
                onPress={() => setTodoView('week')}
                style={styles.todoTabButton}
              >
                <Text style={[styles.todoTabWeek, todoView === 'week' && styles.todoTabActiveText]}>本周待办</Text>
                {todoView === 'week' ? <View style={styles.todoTabUnderline} /> : null}
              </Pressable>
              <Text style={styles.todoTabDivider}>｜</Text>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: todoView === 'all' }}
                onPress={() => setTodoView('all')}
                style={styles.todoTabButton}
              >
                <Text style={[styles.todoTabAll, todoView === 'all' && styles.todoTabActiveText]}>全部待办</Text>
                {todoView === 'all' ? <View style={styles.todoTabUnderline} /> : null}
              </Pressable>
            </View>
            {todosState === 'loading' ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.eventsLoading} />
            ) : todosState === 'error' ? (
              <Pressable style={styles.eventsError} onPress={() => { void load(); }}>
                <Text style={styles.eventsErrorText}>待办暂时加载不了</Text>
                <Text style={styles.eventsRetry}>重试</Text>
              </Pressable>
            ) : (todoView === 'week' ? weekGroups : longTermGroups).length === 0 ? (
              <View style={styles.emptyWeek}>
                <Ionicons name="calendar-outline" size={22} color={theme.colors.textDim} />
                <Text style={styles.emptyWeekTitle}>
                  {todoView === 'week' ? '这周没有安排，记点什么？' : '本周之外没有待办'}
                </Text>
                <Text style={styles.emptyWeekSub}>
                  {todoView === 'week' ? '说一声「周五还书」，它就出现在这里' : '有明确日期的远期待办会出现在这里'}
                </Text>
              </View>
            ) : (
              (todoView === 'week' ? weekGroups : longTermGroups).flatMap(group => (
                group.entries.map(entry => (
                  <View
                    key={entry.id}
                    onLayout={event => {
                      todoRowY.current.set(`${todoView}:${entry.id}`, event.nativeEvent.layout.y);
                      tryFocusTodo();
                    }}
                  >
                    <WeekTaskRow
                      entry={entry}
                      isToday={group.isToday}
                      highlighted={highlightedTodoId === entry.id}
                      onToggle={handleToggle}
                    />
                  </View>
                ))
              ))
            )}
          </View>

          {/* 模块二：持续事件。失败只影响本区，不阻断本周待办和原声。 */}
          <Text style={styles.h1}>事件</Text>
          {eventsState === 'loading' ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.eventsLoading} />
          ) : eventsState === 'error' ? (
            <Pressable style={styles.eventsError} onPress={() => { void loadEvents(); }}>
              <Text style={styles.eventsErrorText}>事件暂时加载不了</Text>
              <Text style={styles.eventsRetry}>重试</Text>
            </Pressable>
          ) : events.length === 0 ? (
            <Text style={styles.eventsEmpty}>还没有需要持续跟进的事</Text>
          ) : events.map(event => (
            <AssistantEventCard
              key={event.id}
              event={event}
              onPress={() => router.push(`/event/${event.id}`)}
              onTogglePin={() => { void handleEventPin(event); }}
              pinning={pinningEventId === event.id}
            />
          ))}

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
                        <Text style={styles.topicCount}>{g.count} 条</Text>
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
  highlighted,
  onToggle,
}: {
  entry: Entry;
  isToday: boolean;
  highlighted: boolean;
  onToggle: (entry: Entry, done: boolean) => void;
}) {
  const done = !!entry.done;
  const overdue = isOverdue(entry);
  return (
    <View style={[
      styles.weekRow,
      isToday && !done && styles.weekRowToday,
      highlighted && styles.weekRowHighlighted,
      done && { opacity: 0.55 },
    ]}>
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
  todoSection: { gap: 10 },
  todoTabs: { minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'flex-end' },
  todoTabButton: { minHeight: theme.touchTarget, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 1 },
  todoTabWeek: { fontSize: 18, lineHeight: 25, fontWeight: '700', color: theme.colors.textDim },
  todoTabAll: { fontSize: 14, lineHeight: 22, fontWeight: '600', color: theme.colors.textDim },
  todoTabActiveText: { color: theme.colors.text },
  todoTabDivider: { color: theme.colors.textDim, fontSize: 15, lineHeight: 27, paddingHorizontal: 1 },
  todoTabUnderline: { width: 22, height: 2, borderRadius: 1, marginTop: 3, backgroundColor: theme.colors.accent },
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
  weekRowHighlighted: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
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
  eventsLoading: { marginVertical: 18 },
  eventsError: { minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  eventsErrorText: { color: theme.colors.textDim, fontSize: theme.font.small },
  eventsRetry: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  eventsEmpty: { color: theme.colors.textDim, fontSize: theme.font.small, paddingVertical: 10 },
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
