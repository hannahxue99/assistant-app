import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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

import { mergeAssistantMessages } from '../../src/assistant/ui-state';
import { retryAssistantTurn, sendAssistantTurn } from '../../src/assistant/orchestrator';
import { getRequestState, listMessages } from '../../src/assistant/store';
import type { AssistantMessage } from '../../src/assistant/types';
import { AssistantComposer } from '../../src/components/AssistantComposer';
import { AssistantEmptyState } from '../../src/components/AssistantEmptyState';
import { AssistantMessageBubble } from '../../src/components/AssistantMessageBubble';
import { getSettings } from '../../src/db';
import { theme } from '../../src/theme';

const PAGE_SIZE = 50;

function makeRequestId(): string {
  return `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AssistantScreen() {
  const router = useRouter();
  const listRef = useRef<FlatList<AssistantMessage>>(null);
  const mountedRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const loadLatest = useCallback(async (scroll = false) => {
    const [page, settings] = await Promise.all([listMessages({ limit: PAGE_SIZE }), getSettings()]);
    if (!mountedRef.current) return;
    setMessages(current => mergeAssistantMessages(current, page));
    setHasOlder(page.length === PAGE_SIZE);
    setConfigured(!!settings.llmEnabled && !!settings.llmKey);
    setLoading(false);
    if (scroll) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      setLoading(true);
      void loadLatest(true).catch(() => {
        if (mountedRef.current) {
          setLoading(false);
          setPageError('对话暂时无法加载，请稍后重试。');
        }
      });
      return () => { mountedRef.current = false; };
    }, [loadLatest]),
  );

  async function loadOlder() {
    if (!hasOlder || loadingOlderRef.current || messages.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await listMessages({ limit: PAGE_SIZE, before: messages[0] });
      if (!mountedRef.current) return;
      setMessages(current => mergeAssistantMessages(current, page));
      setHasOlder(page.length === PAGE_SIZE);
    } finally {
      loadingOlderRef.current = false;
      if (mountedRef.current) setLoadingOlder(false);
    }
  }

  async function send(content: string, source: 'text' | 'voice') {
    setPageError(null);
    const requestId = makeRequestId();
    const job = sendAssistantTurn({ requestId, content, source });
    await Promise.resolve();
    await loadLatest(true).catch(() => {});
    try {
      await job;
    } catch (error: any) {
      const saved = await getRequestState(requestId).catch(() => null);
      if (!saved) throw error;
      setPageError(error?.code === 'missing-key'
        ? '先开启理解引擎，小知才能回复。你的消息已经保存。'
        : '小知暂时没有回复，消息已经保存，可以稍后重试。');
    } finally {
      await loadLatest(true).catch(() => {});
    }
  }

  function retry(requestId: string) {
    setPageError(null);
    void (async () => {
      try {
        const job = retryAssistantTurn({ requestId });
        await Promise.resolve();
        await loadLatest(false);
        await job;
      } catch (error: any) {
        setPageError(error?.code === 'missing-key'
          ? '先开启理解引擎，再重试这条消息。'
          : '还是没有回复。消息保留着，网络恢复后可以再试。');
      } finally {
        await loadLatest(true).catch(() => {});
      }
    })();
  }

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

        {!configured && !loading ? (
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

        {pageError ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>{pageError}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={theme.colors.accent} /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <AssistantMessageBubble message={item} onRetry={retry} />}
            contentContainerStyle={[styles.listContent, messages.length === 0 && styles.emptyList]}
            ListEmptyComponent={<AssistantEmptyState />}
            ListHeaderComponent={loadingOlder ? <ActivityIndicator color={theme.colors.accent} style={styles.olderSpinner} /> : null}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={({ nativeEvent }) => {
              if (nativeEvent.contentOffset.y < 32) void loadOlder();
            }}
            scrollEventThrottle={80}
          />
        )}

        <View style={styles.composerWrap}>
          <AssistantComposer onSend={send} />
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
  errorBanner: { marginHorizontal: theme.spacing.md, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#F8E8E5' },
  errorText: { color: theme.colors.red, fontSize: theme.font.small, lineHeight: 19 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: theme.spacing.md, paddingTop: 5, paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
  olderSpinner: { marginVertical: 8 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg },
  pressed: { opacity: 0.72 },
});
