/** 「首页」只呈现待办与持续事件；所有新输入统一进入小知。 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useRef } from 'react';
import { subscribeEntryChanges } from '../../src/engine/entry-events';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WarmAmbientBackground } from '../../src/components/WarmAmbientBackground';
import { XiaozhiMascot } from '../../src/components/XiaozhiMascot';
import {
  listLongTermTasks,
  listWeekTasks,
  setDone,
} from '../../src/db';
import { syncEntryReminder } from '../../src/engine/notifications';
import {
  groupWeekTasks,
  isOverdue,
  logTimestamp,
  weekTaskLabel,
  type DayGroup,
} from '../../src/engine/schedule';
import type { Entry } from '../../src/types';
import type { AssistantEvent } from '../../src/assistant/action-types';
import { listEvents, setEventPinned } from '../../src/assistant/event-store';
import {
  assistantTodoNavigationIntent,
  listStateWhileRefreshing,
} from '../../src/assistant/ui-state';
import { theme } from '../../src/theme';

type TodoView = 'week' | 'all';

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ todoView?: string; focusTodoId?: string }>();
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
  const loadVersion = useRef(0);

  const loadEvents = useCallback(async (version = loadVersion.current) => {
    setEventsState(listStateWhileRefreshing);
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
    void loadEvents(version);
    setTodosState(listStateWhileRefreshing);
    const todoLists = await Promise.all([listWeekTasks(), listLongTermTasks()])
      .then(([week, longTerm]) => ({ week, longTerm, failed: false as const }))
      .catch(() => ({ week: [] as Entry[], longTerm: [] as Entry[], failed: true as const }));
    if (version !== loadVersion.current) return;
    if (todoLists.failed) setTodosState('error');
    else {
      setWeekGroups(groupWeekTasks(todoLists.week));
      setLongTermGroups(groupWeekTasks(todoLists.longTerm));
      setTodosState('ready');
    }
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
    const intent = assistantTodoNavigationIntent(
      params.todoView,
      params.focusTodoId,
      lastFocusIntent.current,
    );
    if (!intent?.isNew) return;
    lastFocusIntent.current = intent.key;
    setTodoView(intent.view);
    if (!intent.focusTodoId) return;
    pendingFocusTodoId.current = intent.focusTodoId;
    setHighlightedTodoId(intent.focusTodoId);
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

  async function handleToggle(entry: Entry, done: boolean) {
    await setDone(entry.id, done);
    // 完成即撤到点提醒；取消完成则按剩余时间重挂
    await syncEntryReminder({ ...entry, done: done ? 1 : 0, doneAt: done ? Date.now() : null });
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

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 11 ? '早上好' : greetingHour < 18 ? '下午好' : '晚上好';
  const visibleTodoGroups = todoView === 'week' ? weekGroups : longTermGroups;
  const visibleTodos = visibleTodoGroups.flatMap(group => group.entries.map(entry => ({ entry, isToday: group.isToday })));
  const spotlightEvent = events[0] ?? null;
  const recentEvents = events.slice(1);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <WarmAmbientBackground />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.greeting}>{greeting} 👋</Text>
              <Text style={styles.dateLine}>{dateStr} · 今天</Text>
            </View>
            <View style={styles.heroAssistant}>
              <View style={styles.speechBubble}>
                <Text style={styles.speechText}>有我在，{`\n`}一切井井有条。</Text>
              </View>
              <XiaozhiMascot size={92} />
            </View>
          </View>

          {/* 模块一：同一位置切换 7 天窗口和更远待办，两个列表互不重复。 */}
          <View
            style={styles.todoSection}
            onLayout={event => {
              todoSectionY.current = event.nativeEvent.layout.y;
              tryFocusTodo();
            }}
          >
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{todoView === 'week' ? '今日待办' : '全部待办'}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTodoView(todoView === 'week' ? 'all' : 'week')}
                style={styles.sectionAction}
              >
                <Text style={styles.sectionActionText}>{todoView === 'week' ? '查看全部' : '查看本周'}</Text>
                <Ionicons name="chevron-forward" size={17} color={theme.colors.textDim} />
              </Pressable>
            </View>
            {todosState === 'loading' ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.eventsLoading} />
            ) : todosState === 'error' ? (
              <Pressable style={styles.eventsError} onPress={() => { void load(); }}>
                <Text style={styles.eventsErrorText}>待办暂时加载不了</Text>
                <Text style={styles.eventsRetry}>重试</Text>
              </Pressable>
            ) : visibleTodoGroups.length === 0 ? (
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
              <View style={styles.todoCard}>
                {visibleTodos.map(({ entry, isToday }, index) => (
                  <View
                    key={entry.id}
                    onLayout={event => {
                      todoRowY.current.set(`${todoView}:${entry.id}`, event.nativeEvent.layout.y);
                      tryFocusTodo();
                    }}
                  >
                    <WeekTaskRow
                      entry={entry}
                      isToday={isToday}
                      highlighted={highlightedTodoId === entry.id}
                      onToggle={handleToggle}
                    />
                    {index < visibleTodos.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 模块二：持续事件。失败只影响本区，不阻断待办。 */}
          <View style={styles.sectionHead} accessibilityLabel="小知正在关注">
            <Text style={styles.sectionTitle}>小知正在关注</Text>
            <View style={styles.sectionAction}>
              <Text style={styles.sectionActionText}>持续事件</Text>
            </View>
          </View>
          {eventsState === 'loading' ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.eventsLoading} />
          ) : eventsState === 'error' ? (
            <Pressable style={styles.eventsError} onPress={() => { void loadEvents(); }}>
              <Text style={styles.eventsErrorText}>事件暂时加载不了</Text>
              <Text style={styles.eventsRetry}>重试</Text>
            </Pressable>
          ) : !spotlightEvent ? (
            <Text style={styles.eventsEmpty}>还没有需要持续跟进的事</Text>
          ) : (
            <View style={styles.watchingCard}>
              <View style={styles.watchingOrb}>
                <Ionicons name="trending-up" size={27} color={theme.colors.accent} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`查看事件${spotlightEvent.title}`}
                onPress={() => router.push(`/event/${spotlightEvent.id}`)}
                style={({ pressed }) => [styles.watchingContent, pressed && styles.pressed]}
              >
                <Text style={styles.watchingTitle} numberOfLines={1}>{spotlightEvent.title}</Text>
                <Text style={styles.watchingState} numberOfLines={2}>{spotlightEvent.currentState || '暂时还没有明确进展'}</Text>
                <Text style={styles.watchingLink}>查看更新 <Ionicons name="arrow-forward" size={15} /></Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={spotlightEvent.pinnedAt !== null ? `取消置顶${spotlightEvent.title}` : `置顶${spotlightEvent.title}`}
                disabled={pinningEventId === spotlightEvent.id}
                onPress={() => { void handleEventPin(spotlightEvent); }}
                style={styles.pinAction}
              >
                <Ionicons name={spotlightEvent.pinnedAt !== null ? 'bookmark' : 'bookmark-outline'} size={18} color={theme.colors.accent} />
              </Pressable>
            </View>
          )}

          {recentEvents.length > 0 ? (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>最近事件</Text>
                <Text style={styles.sectionActionText}>{recentEvents.length} 件</Text>
              </View>
              <View style={styles.recentCard}>
                {recentEvents.map((event, index) => (
                  <View key={event.id}>
                    <View style={styles.eventRow}>
                      <View style={[styles.eventIcon, index % 3 === 1 ? styles.eventIconViolet : index % 3 === 2 ? styles.eventIconOrange : styles.eventIconGreen]}>
                        <Ionicons name={index % 3 === 1 ? 'airplane-outline' : index % 3 === 2 ? 'home-outline' : 'book-outline'} size={22} color={index % 3 === 1 ? theme.colors.violet : index % 3 === 2 ? theme.colors.accent : theme.colors.green} />
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`查看事件${event.title}`}
                        onPress={() => router.push(`/event/${event.id}`)}
                        style={({ pressed }) => [styles.eventContent, pressed && styles.pressed]}
                      >
                        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                        <Text style={styles.eventState} numberOfLines={1}>{event.currentState || '暂时还没有明确进展'}</Text>
                        <Text style={styles.eventTime}>{logTimestamp(event.updatedAt)}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={event.pinnedAt !== null ? `取消置顶${event.title}` : `置顶${event.title}`}
                        disabled={pinningEventId === event.id}
                        onPress={() => { void handleEventPin(event); }}
                        style={styles.eventChevron}
                      >
                        <Ionicons name={event.pinnedAt !== null ? 'bookmark' : 'chevron-forward'} size={18} color={theme.colors.textDim} />
                      </Pressable>
                    </View>
                    {index < recentEvents.length - 1 ? <View style={styles.eventDivider} /> : null}
                  </View>
                ))}
              </View>
            </>
          ) : null}

      </ScrollView>
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
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 42, gap: 20 },
  hero: { minHeight: 122, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroCopy: { paddingTop: 9, gap: 7 },
  greeting: { color: theme.colors.text, fontSize: 32, lineHeight: 40, fontWeight: theme.fontWeight.bold },
  dateLine: { fontSize: 15, color: theme.colors.textDim },
  heroAssistant: { width: 180, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginRight: -8 },
  speechBubble: { maxWidth: 106, borderRadius: 22, borderBottomRightRadius: 5, backgroundColor: '#FFF0E3', paddingHorizontal: 14, paddingVertical: 12, marginRight: -5 },
  speechText: { color: '#765A49', fontSize: 12, lineHeight: 18 },
  todoSection: { gap: 11 },
  sectionHead: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 30, fontWeight: theme.fontWeight.bold },
  sectionAction: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 10 },
  sectionActionText: { color: theme.colors.textDim, fontSize: 14 },
  todoCard: { backgroundColor: theme.colors.card, borderRadius: theme.radius.card, paddingHorizontal: 16, ...theme.shadow },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: 42 },
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
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.card,
    minHeight: 68,
    paddingVertical: 12,
  },
  weekRowToday: {},
  weekRowHighlighted: { marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 14, backgroundColor: theme.colors.accentSoft },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.colors.green, borderColor: theme.colors.green },
  weekLabel: { fontSize: 15, fontWeight: '700', color: theme.colors.accent, minWidth: 66 },
  weekText: { flex: 1, fontSize: 16, lineHeight: 22, color: theme.colors.text },
  weekTextDone: { textDecorationLine: 'line-through', color: theme.colors.textDim },
  eventsLoading: { marginVertical: 18 },
  eventsError: { minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  eventsErrorText: { color: theme.colors.textDim, fontSize: theme.font.small },
  eventsRetry: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  eventsEmpty: { color: theme.colors.textDim, fontSize: theme.font.small, paddingVertical: 10 },
  watchingCard: { position: 'relative', minHeight: 152, flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.card, backgroundColor: '#FFF1E4', padding: 18, overflow: 'hidden', ...theme.shadow },
  watchingOrb: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFE5D2', marginRight: 14 },
  watchingContent: { flex: 1, gap: 5 },
  watchingTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 26, fontWeight: theme.fontWeight.bold, paddingRight: 24 },
  watchingState: { color: '#5D5149', fontSize: 15, lineHeight: 21 },
  watchingLink: { color: theme.colors.accent, fontSize: 15, lineHeight: 22, fontWeight: theme.fontWeight.semibold, textAlign: 'right', marginTop: 7 },
  pinAction: { position: 'absolute', top: 8, right: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  recentCard: { backgroundColor: theme.colors.card, borderRadius: theme.radius.card, paddingHorizontal: 16, ...theme.shadow },
  eventRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center' },
  eventIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  eventIconGreen: { backgroundColor: theme.colors.greenSoft },
  eventIconViolet: { backgroundColor: theme.colors.violetSoft },
  eventIconOrange: { backgroundColor: theme.colors.accentSoft },
  eventContent: { flex: 1, paddingHorizontal: 13, paddingVertical: 12, gap: 2 },
  eventTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: theme.fontWeight.semibold },
  eventState: { color: '#6E655E', fontSize: 13, lineHeight: 18 },
  eventTime: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  eventChevron: { width: 38, height: 48, alignItems: 'flex-end', justifyContent: 'center' },
  eventDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginLeft: 61 },
  pressed: { opacity: 0.65 },
});
