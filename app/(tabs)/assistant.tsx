import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
  shouldFollowAssistantEnd,
  shouldScrollAssistantOnFocus,
} from '../../src/assistant/ui-state';
import { cancelAssistantTurn, retryAssistantTurn, sendAssistantTurn } from '../../src/assistant/orchestrator';
import { listOperationsByRequestIds } from '../../src/assistant/action-store';
import { undoAssistantRequest } from '../../src/assistant/action-undo';
import { getRequestState, listMessages, saveUserTurn } from '../../src/assistant/store';
import type {
  AssistantEngineStatus,
  AssistantInitialLoadStatus,
  AssistantMessage,
  AssistantOlderLoadStatus,
} from '../../src/assistant/types';
import type { AssistantRuntimeStage } from '../../src/assistant/runtime-state';
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
  const followEndRef = useRef(true);
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

  const displayMessages = useMemo(() => mergeAssistantMessages(messages, Object.values(streamingReplies)), [messages, streamingReplies]);
  const requestStartedAt = useMemo(() => new Map(
    messages
      .filter(message => message.role === 'user')
      .map(message => [message.requestId, message.createdAt] as const),
  ), [messages]);

  const scrollToLatest = useCallback((animated: boolean, keepPending = true) => {
    if (keepPending) pendingEndScrollRef.current = { animated };
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  const handleContentSizeChange = useCallback(() => {
    const pending = pendingEndScrollRef.current;
    if (!pending && !followEndRef.current) return;
    pendingEndScrollRef.current = null;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: pending?.animated ?? false }));
  }, []);

  const updateStreamingReply = useCallback((input: {
    requestId: string;
    messageCreatedAt: number;
    runtimeStartedAt?: number;
    content?: string;
    stage?: AssistantRuntimeStage;
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
          runtimeStage: input.stage ?? existing?.runtimeStage ?? 'thinking',
          runtimeStartedAt: existing?.runtimeStartedAt ?? input.runtimeStartedAt ?? Date.now(),
        },
      };
    });
    if (followEndRef.current) scrollToLatest(false, false);
  }, [scrollToLatest]);

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

  const loadLatest = useCallback(async (scroll = false) => {
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
    if (scroll) {
      followEndRef.current = true;
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
        followingEnd: followEndRef.current,
        preserveReturn,
      });
      if (preserveReturn) {
        pendingEndScrollRef.current = null;
        followEndRef.current = false;
      }
      if (!loadedOnce) setInitialLoad('loading');
      void loadLatest(shouldScroll).catch(() => {
        if (mountedRef.current && !loadedOnceRef.current) setInitialLoad('error');
      });
      return () => { mountedRef.current = false; };
    }, [loadLatest]),
  );

  const navigateFromMessage = useCallback((target: string) => {
    preservePositionOnNextFocusRef.current = true;
    pendingEndScrollRef.current = null;
    followEndRef.current = false;
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
    void loadLatest(true)
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setRetryingInitialLoad(false); });
  }

  async function send(content: string, source: 'text' | 'voice') {
    const requestId = makeRequestId();
    const userMessage = await saveUserTurn({ requestId, content, source });
    const runtimeStartedAt = Date.now();
    if (mountedRef.current) {
      setMessages(current => mergeAssistantMessages(current, [userMessage]));
      updateStreamingReply({
        requestId,
        messageCreatedAt: userMessage.createdAt,
        runtimeStartedAt,
        stage: 'thinking',
      });
      followEndRef.current = true;
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
      }),
      onProgress: stage => updateStreamingReply({
        requestId,
        messageCreatedAt: userMessage.createdAt,
        runtimeStartedAt,
        stage,
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
          }]));
        }
      })
      .catch(async () => {
        await getRequestState(requestId).catch(() => null);
      })
      .finally(async () => {
        clearStreamingReply(requestId);
        await loadLatest(true).catch(() => {});
      });
  }

  async function stopCurrentTurn(requestId: string | null) {
    if (!requestId || stoppingRequestId) return;
    setStoppingRequestId(requestId);
    try {
      await cancelAssistantTurn(requestId);
      clearStreamingReply(requestId);
      await loadLatest(true);
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
          stage: 'thinking',
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
          }),
          onProgress: stage => updateStreamingReply({
            requestId,
            messageCreatedAt: userMessage?.createdAt ?? runtimeStartedAt,
            runtimeStartedAt,
            stage,
          }),
        });
        await Promise.resolve();
        await loadLatest(false);
        const result = await job;
        if (mountedRef.current) {
          clearStreamingReply(requestId);
          setMessages(current => mergeAssistantMessages(current, [{
            ...result.assistantMessage,
            operations: result.operations,
            runtimeStartedAt,
          }]));
        }
      } catch {
        // 错误状态由对应消息承载，不再重复显示页面级错误。
      } finally {
        clearStreamingReply(requestId);
        await loadLatest(true).catch(() => {});
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
        await loadLatest(false).catch(() => {});
        if (mountedRef.current) setUndoingRequestId(null);
      });
  }

  const composerDisabled = isAssistantComposerDisabled(initialLoad, messages);
  const activeRequestId = pendingAssistantRequestId(messages);
  const composerProcessing = hasPendingAssistantReply(messages);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>小知</Text>
            <Text style={styles.caption}>连续对话 · 自动保存</Text>
          </View>
        </View>

        {engineStatus === 'unconfigured' && initialLoad === 'ready' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前往配置理解引擎"
            onPress={() => router.push('/settings/llm')}
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
            data={displayMessages}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <AssistantMessageBubble
                message={item}
                onRetry={retry}
                canRetry={canRetryAssistantMessage(item, messages, engineStatus)}
                onNavigate={navigateFromMessage}
                onUndo={undo}
                undoing={undoingRequestId === item.requestId}
                undoError={undoErrors[item.requestId]}
                runtimeStartedAt={item.runtimeStartedAt ?? requestStartedAt.get(item.requestId)}
              />
            )}
            contentContainerStyle={[styles.listContent, messages.length === 0 && styles.emptyList]}
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
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onContentSizeChange={handleContentSizeChange}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={({ nativeEvent }) => {
              followEndRef.current = shouldFollowAssistantEnd({
                contentHeight: nativeEvent.contentSize.height,
                viewportHeight: nativeEvent.layoutMeasurement.height,
                offsetY: nativeEvent.contentOffset.y,
              });
              if (nativeEvent.contentOffset.y < 32) void loadOlder();
            }}
            scrollEventThrottle={80}
          />
        )}

        <View style={styles.composerWrap}>
          <AssistantComposer
            onSend={send}
            onStop={() => stopCurrentTurn(activeRequestId)}
            disabled={composerDisabled}
            processing={composerProcessing || stoppingRequestId !== null}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: theme.spacing.md, paddingTop: 7, paddingBottom: 8, justifyContent: 'center' },
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
  listContent: { paddingHorizontal: theme.spacing.md, paddingTop: 5, paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
  olderSpinner: { marginVertical: 8 },
  olderError: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 },
  olderErrorText: { color: theme.colors.textDim, fontSize: theme.font.small },
  olderRetryText: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  composerWrap: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 6, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg },
  pressed: { opacity: 0.72 },
});
