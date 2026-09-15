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

import { AssistantEventCard } from '../../src/components/AssistantEventCard';
import {
  listLongTermTasks,
  listWeekTasks,
  setDone,
} from '../../src/db';
import { syncEntryReminder } from '../../src/engine/notifications';
import {
  groupWeekTasks,
  isOverdue,
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

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
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
              </Pressable>
              <Text style={styles.todoTabDivider}>｜</Text>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: todoView === 'all' }}
                onPress={() => setTodoView('all')}
                style={styles.todoTabButton}
              >
                <Text style={[styles.todoTabAll, todoView === 'all' && styles.todoTabActiveText]}>全部待办</Text>
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

          {/* 模块二：持续事件。失败只影响本区，不阻断待办。 */}
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
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  dateLine: { fontSize: theme.font.small, color: theme.colors.textDim },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text, marginTop: 8 },
  todoSection: { gap: 10 },
  todoTabs: { minHeight: theme.touchTarget, flexDirection: 'row', alignItems: 'center' },
  todoTabButton: { minHeight: theme.touchTarget, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 1 },
  todoTabWeek: { fontSize: 18, lineHeight: 25, fontWeight: '700', color: '#A9A29A' },
  todoTabAll: { fontSize: 14, lineHeight: 22, fontWeight: '600', color: '#A9A29A' },
  todoTabActiveText: { color: theme.colors.text },
  todoTabDivider: { color: '#A9A29A', fontSize: 15, lineHeight: 27, paddingHorizontal: 1 },
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
});
