import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  canRetryAssistantMessage,
  canLoadOlderAssistantMessages,
  hasPendingAssistantReply,
  isAssistantComposerDisabled,
  mergeAssistantMessages,
  pendingAssistantRequestId,
  assistantScrollPresentation,
  shouldMaintainAssistantEndAfterLayout,
  shouldScrollAssistantAfterRefresh,
  shouldScrollAssistantOnFocus,
} from '../../src/assistant/ui-state';
import type { AssistantRefreshScrollMode } from '../../src/assistant/ui-state';
import { cancelAssistantTurn, retryAssistantTurn, sendAssistantTurn } from '../../src/assistant/orchestrator';
import { listOperationsByRequestIds } from '../../src/assistant/action-store';
import { undoAssistantRequest } from '../../src/assistant/action-undo';
import { getRequestState, listMessages, saveUserTurn } from '../../src/assistant/store';
import type {
  AssistantEngineStatus,
  AssistantInitialLoadStatus,
  AssistantMessage,
  AssistantOlderLoadStatus,
  AssistantStageSegment,
} from '../../src/assistant/types';
import type { AssistantRuntimeStage } from '../../src/assistant/runtime-state';
import { getAssistantReasoning } from '../../src/assistant/reasoning-store';
import {
  formatAssistantDateSeparator,
  shouldShowAssistantDateSeparator,
} from '../../src/assistant/message-time';
import { AssistantComposer } from '../../src/components/AssistantComposer';
import { AssistantEmptyState } from '../../src/components/AssistantEmptyState';
import { AssistantLoadErrorState } from '../../src/components/AssistantLoadErrorState';
import { AssistantMessageBubble } from '../../src/components/AssistantMessageBubble';
import { getSettings } from '../../src/db';
import { theme } from '../../src/theme';

const PAGE_SIZE = 50;

function makeRequestId(): string {
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AssistantScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    contextKind?: 'event' | 'todo' | 'reminder';
    contextId?: string;
    contextLabel?: string;
    contextState?: string;
  }>();
  const launchContext = useMemo(() => (
    params.contextKind && params.contextId && params.contextLabel
      ? {
        kind: params.contextKind,
        id: params.contextId,
        label: params.contextLabel,
        state: params.contextState,
      }
      : null
  ), [params.contextId, params.contextKind, params.contextLabel, params.contextState]);
  const listRef = useRef<FlatList<AssistantMessage>>(null);
  const mountedRef = useRef(true);
  const loadedOnceRef = useRef(false);
  const olderLoadRef = useRef<AssistantOlderLoadStatus>('idle');
  const pendingEndScrollRef = useRef<{ animated: boolean } | null>(null);
  const viewportHeightRef = useRef<number | null>(null);
  const composerHeightRef = useRef<number | null>(null);
  const followEndOnKeyboardOpenRef = useRef<boolean | null>(null);
  const userScrollInProgressRef = useRef(false);
  const scrollModeRef = useRef<'following' | 'history'>('following');
  const lastScrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const pendingPrependAnchorRef = useRef<{ contentHeight: number; offsetY: number } | null>(null);
  const stageSegmentsRef = useRef<Map<string, AssistantStageSegment[]>>(new Map());
  const preservePositionOnNextFocusRef = useRef(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [initialLoad, setInitialLoad] = useState<AssistantInitialLoadStatus>('loading');
  const [retryingInitialLoad, setRetryingInitialLoad] = useState(false);
  const [olderLoad, setOlderLoad] = useState<AssistantOlderLoadStatus>('idle');
  const [hasOlder, setHasOlder] = useState(false);
  const [engineStatus, setEngineStatus] = useState<AssistantEngineStatus>('unknown');
  const [undoingRequestId, setUndoingRequestId] = useState<string | null>(null);
  const [stoppingRequestId, setStoppingRequestId] = useState<string | null>(null);
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});
  const [streamingReplies, setStreamingReplies] = useState<Record<string, AssistantMessage>>({});
  const [composerHeight, setComposerHeight] = useState(68);
  const [scrollPresentation, setScrollPresentation] = useState({
    atBottom: true,
    showJumpToLatest: false,
    elevation: 0,
  });

  const displayMessages = useMemo(() => mergeAssistantMessages(messages, Object.values(streamingReplies)), [messages, streamingReplies]);
  const requestStartedAt = useMemo(() => new Map(
    messages
      .filter(message => message.role === 'user')
      .map(message => [message.requestId, message.createdAt] as const),
  ), [messages]);

  const scrollToLatest = useCallback((animated: boolean, keepPending = true) => {
    if (keepPending) pendingEndScrollRef.current = { animated };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
    });
  }, []);

  const handleContentSizeChange = useCallback((_contentWidth: number, contentHeight: number) => {
    lastScrollMetricsRef.current = {
      ...lastScrollMetricsRef.current,
      contentHeight,
    };
    const prependAnchor = pendingPrependAnchorRef.current;
    if (prependAnchor) {
      pendingPrependAnchorRef.current = null;
      const addedHeight = Math.max(0, contentHeight - prependAnchor.contentHeight);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({
          offset: prependAnchor.offsetY + addedHeight,
          animated: false,
        });
      });
      return;
    }
    const pending = pendingEndScrollRef.current;
    if (!pending && scrollModeRef.current !== 'following') return;
    pendingEndScrollRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: pending?.animated ?? false }));
    });
  }, []);

  const keepLatestVisibleAfterLayout = useCallback(() => {
    if (scrollModeRef.current !== 'following') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollModeRef.current !== 'following') return;
        listRef.current?.scrollToEnd({ animated: false });
      });
    });
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      const shouldFollow = followEndOnKeyboardOpenRef.current
        ?? scrollModeRef.current === 'following';
      if (shouldFollow) keepLatestVisibleAfterLayout();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      const shouldFollow = followEndOnKeyboardOpenRef.current === true
        && scrollModeRef.current === 'following';
      if (shouldFollow) keepLatestVisibleAfterLayout();
      followEndOnKeyboardOpenRef.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keepLatestVisibleAfterLayout]);

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    const shouldMaintain = shouldMaintainAssistantEndAfterLayout({
      previousSize: viewportHeightRef.current,
      nextSize: nextHeight,
      followingEnd: scrollModeRef.current === 'following',
    });
    const shouldPinForKeyboard = followEndOnKeyboardOpenRef.current === true
      && scrollModeRef.current === 'following';
    viewportHeightRef.current = nextHeight;
    if (shouldPinForKeyboard) keepLatestVisibleAfterLayout();
    else if (shouldMaintain) keepLatestVisibleAfterLayout();
  }, [keepLatestVisibleAfterLayout]);

  const handleComposerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    const shouldMaintain = shouldMaintainAssistantEndAfterLayout({
      previousSize: composerHeightRef.current,
      nextSize: nextHeight,
      followingEnd: scrollModeRef.current === 'following',
    });
    composerHeightRef.current = nextHeight;
    setComposerHeight(nextHeight);
    if (shouldMaintain) keepLatestVisibleAfterLayout();
  }, [keepLatestVisibleAfterLayout]);

  const updateStreamingReply = useCallback((input: {
    requestId: string;
    messageCreatedAt: number;
    runtimeStartedAt?: number;
    content?: string;
    stage?: AssistantRuntimeStage;
    stageSegments?: AssistantStageSegment[];
    reasoningContent?: string;
    reasoningCompletedAt?: number;
  }) => {
    if (!mountedRef.current) return;
    setStreamingReplies((current) => {
      const existing = current[input.requestId];
      return {
        ...current,
        [input.requestId]: {
          id: `streaming-${input.requestId}`,
          requestId: input.requestId,
          role: 'assistant',
          content: input.content ?? existing?.content ?? '',
          source: 'assistant',
          status: 'streaming',
          segmentId: 'streaming',
          createdAt: input.messageCreatedAt + 1,
          updatedAt: Date.now(),
          legacyEntryId: null,
          errorCode: null,
          runtimeStage: input.stage ?? existing?.runtimeStage ?? 'planning',
          stageSegments: input.stageSegments ?? existing?.stageSegments,
          runtimeStartedAt: existing?.runtimeStartedAt ?? input.runtimeStartedAt ?? Date.now(),
          reasoningAvailable: Boolean(input.reasoningContent || existing?.reasoningAvailable),
          reasoningContent: input.reasoningContent ?? existing?.reasoningContent,
          reasoningStartedAt: input.reasoningContent
            ? existing?.reasoningStartedAt ?? Date.now()
            : existing?.reasoningStartedAt,
          reasoningCompletedAt: input.reasoningCompletedAt ?? existing?.reasoningCompletedAt,
        },
      };
    });
    if (scrollModeRef.current === 'following') scrollToLatest(false, false);
  }, [scrollToLatest]);

  /** 阶段切换时逐行累加：上一阶段定格为一行耗时，当前阶段继续转圈计时。 */
  const advanceStage = useCallback((requestId: string, stage: AssistantRuntimeStage, base: {
    messageCreatedAt: number;
    runtimeStartedAt: number;
  }) => {
    const existing = stageSegmentsRef.current.get(requestId) ?? [];
    const last = existing.at(-1);
    if (last && last.stage === stage) return;
    const now = Date.now();
    const next = [...existing];
    if (last) next[next.length - 1] = { ...last, endedAt: now };
    next.push({ stage, startedAt: now, endedAt: null });
    stageSegmentsRef.current.set(requestId, next);
    updateStreamingReply({
      requestId,
      messageCreatedAt: base.messageCreatedAt,
      runtimeStartedAt: base.runtimeStartedAt,
      stage,
      stageSegments: next,
    });
  }, [updateStreamingReply]);

  const clearStageSegments = useCallback((requestId: string) => {
    stageSegmentsRef.current.delete(requestId);
  }, []);

  const clearStreamingReply = useCallback((requestId: string) => {
    setStreamingReplies((current) => {
      if (!current[requestId]) return current;
      const next = { ...current };
      delete next[requestId];
      return next;
    });
  }, []);

  const attachOperations = useCallback(async (page: AssistantMessage[]) => {
    const byRequest = await listOperationsByRequestIds(
      page.filter(message => message.role === 'assistant').map(message => message.requestId),
    );
    return page.map(message => message.role === 'assistant'
      ? { ...message, operations: byRequest.get(message.requestId) ?? [] }
      : message);
  }, []);

  const loadLatest = useCallback(async (scrollMode: AssistantRefreshScrollMode = 'never') => {
    const [rawPage, settings] = await Promise.all([
      listMessages({ limit: PAGE_SIZE }),
      getSettings().catch(() => null),
    ]);
    const page = await attachOperations(rawPage);
    if (!mountedRef.current) return;
    setMessages(current => mergeAssistantMessages(current, page));
    setHasOlder(page.length === PAGE_SIZE);
    setEngineStatus(settings
      ? (settings.llmEnabled && settings.llmKey ? 'configured' : 'unconfigured')
      : 'unknown');
    loadedOnceRef.current = true;
    setInitialLoad('ready');
    if (shouldScrollAssistantAfterRefresh(scrollMode, scrollModeRef.current === 'following')) {
      scrollModeRef.current = 'following';
      scrollToLatest(false);
    }
  }, [attachOperations, scrollToLatest]);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      olderLoadRef.current = 'idle';
      setOlderLoad('idle');
      const loadedOnce = loadedOnceRef.current;
      const preserveReturn = preservePositionOnNextFocusRef.current;
      preservePositionOnNextFocusRef.current = false;
      const shouldScroll = shouldScrollAssistantOnFocus({
        loadedOnce,
        followingEnd: scrollModeRef.current === 'following',
        preserveReturn,
      });
      if (preserveReturn) {
        pendingEndScrollRef.current = null;
        scrollModeRef.current = 'history';
      } else if (shouldScroll) {
        scrollModeRef.current = 'following';
        setScrollPresentation({ atBottom: true, showJumpToLatest: false, elevation: 0 });
      }
      if (!loadedOnce) setInitialLoad('loading');
      void loadLatest(shouldScroll ? 'always' : 'never').catch(() => {
        if (mountedRef.current && !loadedOnceRef.current) setInitialLoad('error');
      });
      return () => {
        mountedRef.current = false;
        Keyboard.dismiss();
      };
    }, [loadLatest]),
  );

  const navigateFromMessage = useCallback((target: string) => {
    preservePositionOnNextFocusRef.current = true;
    pendingEndScrollRef.current = null;
    scrollModeRef.current = 'history';
    Keyboard.dismiss();
    router.push(target as never);
  }, [router]);

  const navigateAway = useCallback((target: string) => {
    preservePositionOnNextFocusRef.current = true;
    pendingEndScrollRef.current = null;
    scrollModeRef.current = 'history';
    Keyboard.dismiss();
    router.push(target as never);
  }, [router]);

  async function loadOlder(force = false) {
    if (!hasOlder || messages.length === 0 || initialLoad !== 'ready') return;
    if (!canLoadOlderAssistantMessages(olderLoadRef.current, force)) return;
    olderLoadRef.current = 'loading';
    setOlderLoad('loading');
    try {
      const page = await attachOperations(await listMessages({ limit: PAGE_SIZE, before: messages[0] }));
      if (!mountedRef.current) return;
      const metrics = lastScrollMetricsRef.current;
      pendingPrependAnchorRef.current = {
        contentHeight: metrics.contentHeight,
        offsetY: metrics.offsetY,
      };
      setMessages(current => mergeAssistantMessages(current, page));
      setHasOlder(page.length === PAGE_SIZE);
      olderLoadRef.current = 'idle';
      setOlderLoad('idle');
    } catch {
      if (!mountedRef.current) return;
      olderLoadRef.current = 'error';
      setOlderLoad('error');
    } finally {
      if (!mountedRef.current) olderLoadRef.current = 'idle';
    }
  }

  function retryInitialLoad() {
    if (retryingInitialLoad) return;
    setRetryingInitialLoad(true);
    void loadLatest('always')
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setRetryingInitialLoad(false); });
  }

  async function send(content: string, source: 'text' | 'voice') {
    const requestId = makeRequestId();
    const userMessage = await saveUserTurn({ requestId, content, source });
    const runtimeStartedAt = Date.now();
    if (mountedRef.current) {
      setMessages(current => mergeAssistantMessages(current, [userMessage]));
      advanceStage(requestId, 'planning', { messageCreatedAt: userMessage.createdAt, runtimeStartedAt });
      scrollModeRef.current = 'following';
      setScrollPresentation({ atBottom: true, showJumpToLatest: false, elevation: 0 });
      scrollToLatest(true);
    }
    const job = sendAssistantTurn({
      requestId,
      content,
      source,
      launchContext,
      onReplyText: text => updateStreamingReply({
        requestId,
        messageCreatedAt: userMessage.createdAt,
        runtimeStartedAt,
        content: text,
        stage: 'answering',
        reasoningCompletedAt: Date.now(),
      }),
      onReasoningText: text => updateStreamingReply({
        requestId,
        messageCreatedAt: userMessage.createdAt,
        runtimeStartedAt,
        reasoningContent: text,
        stage: 'planning',
      }),
      onProgress: stage => advanceStage(requestId, stage, {
        messageCreatedAt: userMessage.createdAt,
        runtimeStartedAt,
      }),
    });
    void job
      .then((result) => {
        if (mountedRef.current) {
          clearStreamingReply(requestId);
          setMessages(current => mergeAssistantMessages(current, [{
            ...result.assistantMessage,
            operations: result.operations,
            runtimeStartedAt,
            reasoningAvailable: Boolean(result.reasoning),
            reasoningContent: result.reasoning?.content,
            reasoningStartedAt: result.reasoning?.startedAt,
            reasoningCompletedAt: result.reasoning?.completedAt,
          }]));
        }
      })
      .catch(async () => {
        await getRequestState(requestId).catch(() => null);
      })
      .finally(async () => {
        clearStreamingReply(requestId);
        clearStageSegments(requestId);
        await loadLatest('if-following').catch(() => {});
      });
  }

  async function stopCurrentTurn(requestId: string | null) {
    if (!requestId || stoppingRequestId) return;
    setStoppingRequestId(requestId);
    try {
      await cancelAssistantTurn(requestId);
      clearStreamingReply(requestId);
      await loadLatest('if-following');
    } finally {
      if (mountedRef.current) setStoppingRequestId(null);
    }
  }

  function retry(requestId: string) {
    const runtimeStartedAt = Date.now();
    setMessages(current => current.map(item => (
      item.requestId === requestId && item.role === 'user'
        ? { ...item, status: 'sending', errorCode: null, updatedAt: Date.now() }
        : item
    )));
    void (async () => {
      try {
        const userMessage = messages.find(item => item.requestId === requestId && item.role === 'user');
        updateStreamingReply({
          requestId,
          messageCreatedAt: userMessage?.createdAt ?? runtimeStartedAt,
          runtimeStartedAt,
          stage: 'planning',
        });
        const job = retryAssistantTurn({
          requestId,
          launchContext,
          onReplyText: text => updateStreamingReply({
            requestId,
            messageCreatedAt: userMessage?.createdAt ?? runtimeStartedAt,
            runtimeStartedAt,
            content: text,
            stage: 'answering',
            reasoningCompletedAt: Date.now(),
          }),
          onReasoningText: text => updateStreamingReply({
            requestId,
            messageCreatedAt: userMessage?.createdAt ?? runtimeStartedAt,
            runtimeStartedAt,
            reasoningContent: text,
            stage: 'planning',
          }),
          onProgress: stage => updateStreamingReply({
            requestId,
            messageCreatedAt: userMessage?.createdAt ?? runtimeStartedAt,
            runtimeStartedAt,
            stage,
          }),
        });
        await Promise.resolve();
        await loadLatest('never');
        const result = await job;
        if (mountedRef.current) {
          clearStreamingReply(requestId);
          setMessages(current => mergeAssistantMessages(current, [{
            ...result.assistantMessage,
            operations: result.operations,
            runtimeStartedAt,
            reasoningAvailable: Boolean(result.reasoning),
            reasoningContent: result.reasoning?.content,
            reasoningStartedAt: result.reasoning?.startedAt,
            reasoningCompletedAt: result.reasoning?.completedAt,
          }]));
        }
      } catch {
        // 错误状态由对应消息承载，不再重复显示页面级错误。
      } finally {
        clearStreamingReply(requestId);
        clearStageSegments(requestId);
        await loadLatest('if-following').catch(() => {});
      }
    })();
  }

  function undo(requestId: string) {
    if (undoingRequestId) return;
    setUndoingRequestId(requestId);
    setUndoErrors(current => ({ ...current, [requestId]: '' }));
    void undoAssistantRequest(requestId)
      .then((result) => {
        if (result.status === 'conflict') {
          setUndoErrors(current => ({ ...current, [requestId]: '这件事后来有了新变化，不能自动撤销。可以直接告诉小知要怎么改。' }));
        }
      })
      .catch(() => {
        setUndoErrors(current => ({ ...current, [requestId]: '暂时没能撤销，请稍后再试。' }));
      })
      .finally(async () => {
        await loadLatest('never').catch(() => {});
        if (mountedRef.current) setUndoingRequestId(null);
      });
  }

  const composerDisabled = isAssistantComposerDisabled(initialLoad, messages);
  const activeRequestId = pendingAssistantRequestId(messages);
  const composerProcessing = hasPendingAssistantReply(messages);

  const jumpToLatest = useCallback(() => {
    scrollModeRef.current = 'following';
    followEndOnKeyboardOpenRef.current = true;
    setScrollPresentation({ atBottom: true, showJumpToLatest: false, elevation: 0 });
    scrollToLatest(true, false);
  }, [scrollToLatest]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>小知</Text>
            <Text style={styles.caption}>连续对话 · 自动保存</Text>
          </View>
          {__DEV__ ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="打开决策日志调试页"
              onPress={() => navigateAway('/debug/decisions')}
              hitSlop={8}
              style={({ pressed }) => [styles.debugEntry, pressed && styles.pressed]}
            >
              <Ionicons name="terminal-outline" size={20} color={theme.colors.textDim} />
            </Pressable>
          ) : null}
        </View>

        {engineStatus === 'unconfigured' && initialLoad === 'ready' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前往配置理解引擎"
            onPress={() => navigateAway('/settings/llm')}
            style={({ pressed }) => [styles.configBanner, pressed && styles.pressed]}
          >
            <Text style={styles.configText}>开启理解引擎后，小知才能回复</Text>
            <Text style={styles.configAction}>去配置 ›</Text>
          </Pressable>
        ) : null}

        {launchContext ? (
          <View style={styles.contextBanner}>
            <Ionicons name="git-branch-outline" size={17} color={theme.colors.accent} />
            <View style={styles.contextTextWrap}>
              <Text style={styles.contextLabel}>正在聊这件事</Text>
              <Text style={styles.contextTitle} numberOfLines={1}>{launchContext.label}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="退出事件上下文"
              onPress={() => router.replace('/assistant')}
              style={styles.contextClose}
            >
              <Ionicons name="close" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>
        ) : null}

        {initialLoad === 'loading' ? (
          <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} /></View>
        ) : initialLoad === 'error' ? (
          <AssistantLoadErrorState retrying={retryingInitialLoad} onRetry={retryInitialLoad} />
        ) : (
          <FlatList
            ref={listRef}
            style={styles.list}
            data={displayMessages}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <View>
                {shouldShowAssistantDateSeparator(
                  item.createdAt,
                  index > 0 ? displayMessages[index - 1]?.createdAt : undefined,
                ) ? (
                  <View style={styles.dateSeparatorWrap}>
                    <Text style={styles.dateSeparatorText}>
                      {formatAssistantDateSeparator(item.createdAt)}
                    </Text>
                  </View>
                ) : null}
                <AssistantMessageBubble
                  message={item}
                  onRetry={retry}
                  canRetry={canRetryAssistantMessage(item, messages, engineStatus)}
                  onNavigate={navigateFromMessage}
                  onUndo={undo}
                  undoing={undoingRequestId === item.requestId}
                  undoError={undoErrors[item.requestId]}
                  runtimeStartedAt={item.runtimeStartedAt ?? requestStartedAt.get(item.requestId)}
                  onLoadReasoning={getAssistantReasoning}
                />
              </View>
            )}
            contentContainerStyle={[
              styles.listContent,
              messages.length === 0 && styles.emptyList,
            ]}
            ListEmptyComponent={<AssistantEmptyState />}
            ListHeaderComponent={olderLoad === 'loading' ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.olderSpinner} />
            ) : olderLoad === 'error' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新加载更早记录"
                onPress={() => { void loadOlder(true); }}
                style={({ pressed }) => [styles.olderError, pressed && styles.pressed]}
              >
                <Text style={styles.olderErrorText}>更早记录暂时加载不了</Text>
                <Text style={styles.olderRetryText}>重试</Text>
              </Pressable>
            ) : null}
            ListFooterComponent={<View style={{ height: composerHeight + 18 }} />}
            onLayout={handleListLayout}
            onContentSizeChange={handleContentSizeChange}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={({ nativeEvent }) => {
              const metrics = {
                contentHeight: nativeEvent.contentSize.height,
                viewportHeight: nativeEvent.layoutMeasurement.height,
                offsetY: nativeEvent.contentOffset.y,
              };
              lastScrollMetricsRef.current = metrics;
              const nextPresentation = assistantScrollPresentation(metrics);
              const fromUser = userScrollInProgressRef.current;
              if (fromUser) {
                scrollModeRef.current = nextPresentation.atBottom ? 'following' : 'history';
                followEndOnKeyboardOpenRef.current = nextPresentation.atBottom;
              }
              if (fromUser || followEndOnKeyboardOpenRef.current !== true) {
                setScrollPresentation(nextPresentation);
              }
              if (nativeEvent.contentOffset.y < 32) void loadOlder();
            }}
            onScrollBeginDrag={() => {
              userScrollInProgressRef.current = true;
              followEndOnKeyboardOpenRef.current = false;
            }}
            onScrollEndDrag={() => {
              userScrollInProgressRef.current = false;
            }}
            onMomentumScrollBegin={() => {
              userScrollInProgressRef.current = true;
            }}
            onMomentumScrollEnd={() => {
              userScrollInProgressRef.current = false;
            }}
            scrollEventThrottle={16}
          />
        )}

        <View
          style={styles.composerWrap}
          onLayout={handleComposerLayout}
        >
          {scrollPresentation.elevation > 0 ? (
            <View
              pointerEvents="none"
              style={[styles.composerShadowFade, { opacity: scrollPresentation.elevation }]}
            />
          ) : null}
          {scrollPresentation.showJumpToLatest ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="回到最新消息"
              hitSlop={4}
              onPress={jumpToLatest}
              style={({ pressed }) => [styles.jumpToLatest, pressed && styles.jumpToLatestPressed]}
            >
              <View style={styles.jumpToLatestCircle}>
                <Ionicons name="chevron-down" size={18} color={theme.colors.textDim} />
              </View>
            </Pressable>
          ) : null}
          <AssistantComposer
            onSend={send}
            onStop={() => stopCurrentTurn(activeRequestId)}
            onInputFocus={() => {
              followEndOnKeyboardOpenRef.current = scrollModeRef.current === 'following';
            }}
            disabled={composerDisabled}
            processing={composerProcessing || stoppingRequestId !== null}
            elevation={scrollPresentation.elevation}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: theme.spacing.md, paddingTop: 7, paddingBottom: 8, justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' },
  debugEntry: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.text, fontSize: theme.font.title, fontWeight: theme.fontWeight.semibold },
  caption: { color: theme.colors.textDim, fontSize: 12, marginTop: 1 },
  configBanner: { minHeight: 44, marginHorizontal: theme.spacing.md, marginBottom: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.colors.goldSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  configText: { color: theme.colors.text, fontSize: theme.font.small, flex: 1 },
  configAction: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  contextBanner: { minHeight: 52, marginHorizontal: theme.spacing.md, marginBottom: 6, paddingLeft: 12, borderRadius: 13, backgroundColor: theme.colors.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 9 },
  contextTextWrap: { flex: 1, paddingVertical: 7 },
  contextLabel: { color: theme.colors.textDim, fontSize: 11 },
  contextTitle: { color: theme.colors.text, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold, marginTop: 1 },
  contextClose: { width: theme.touchTarget, height: theme.touchTarget, alignItems: 'center', justifyContent: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: theme.spacing.md, paddingTop: 5 },
  emptyList: { flexGrow: 1 },
  olderSpinner: { marginVertical: 8 },
  olderError: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 },
  olderErrorText: { color: theme.colors.textDim, fontSize: theme.font.small },
  olderRetryText: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  dateSeparatorWrap: { alignItems: 'center', paddingTop: 7, paddingBottom: 3 },
  dateSeparatorText: { color: theme.colors.textDim, fontSize: 11, lineHeight: 17, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 11, backgroundColor: theme.colors.card },
  composerWrap: { position: 'absolute', zIndex: 10, left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 5, paddingBottom: 6 },
  composerShadowFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -58,
    bottom: 0,
    experimental_backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.62) 52%, rgba(255,255,255,0.98) 100%)',
  },
  jumpToLatest: { position: 'absolute', zIndex: 2, top: -49, left: '50%', width: 44, height: 44, marginLeft: -22, alignItems: 'center', justifyContent: 'center' },
  jumpToLatestCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(28, 28, 30, 0.10)', shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, shadowOpacity: 0.12, elevation: 4 },
  jumpToLatestPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  pressed: { opacity: 0.72 },
});
