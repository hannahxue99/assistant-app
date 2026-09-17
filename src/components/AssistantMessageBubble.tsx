import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  assistantCompletedRuntimeLabel,
  assistantRuntimeLabel,
} from '../assistant/runtime-state';
import { assistantFailureLabel } from '../assistant/ui-state';
import type { AssistantMessage } from '../assistant/types';
import { theme } from '../theme';
import { AssistantActionReceipt } from './AssistantActionReceipt';

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
  onRetry: (requestId: string) => void;
  canRetry?: boolean;
  onNavigate?: (target: string) => void;
  onUndo?: (requestId: string) => void;
  undoing?: boolean;
  undoError?: string | null;
  runtimeStartedAt?: number;
}

export function AssistantMessageBubble({
  message,
  onRetry,
  canRetry = false,
  onNavigate = () => {},
  onUndo = () => {},
  undoing = false,
  undoError = null,
  runtimeStartedAt,
}: AssistantMessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = !isUser && message.status === 'streaming';
  const [now, setNow] = useState(() => Date.now());
  const startedAt = message.runtimeStartedAt ?? runtimeStartedAt;
  useEffect(() => {
    if (!isStreaming || startedAt === undefined) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isStreaming, startedAt]);
  const elapsedMs = startedAt === undefined
    ? 0
    : Math.max(0, (isStreaming ? now : message.createdAt) - startedAt);
  const completedRuntime = !isUser && !isStreaming && startedAt !== undefined && elapsedMs <= 300_000
    ? assistantCompletedRuntimeLabel(elapsedMs)
    : null;
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {isStreaming && startedAt !== undefined ? (
        <View
          accessibilityLabel={assistantRuntimeLabel(message.runtimeStage ?? 'thinking', elapsedMs)}
          style={styles.runtimeRow}
        >
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.runtimeText}>
            {assistantRuntimeLabel(message.runtimeStage ?? 'thinking', elapsedMs)}
          </Text>
        </View>
      ) : null}
      {message.content ? (
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.content, isUser && styles.userContent]}>
            {message.content}{isStreaming ? <Text style={styles.cursor}>▋</Text> : null}
          </Text>
          {!isStreaming ? (
            <Text style={[styles.time, isUser && styles.userTime]}>
              {completedRuntime ? `${completedRuntime} · ` : ''}{formatMessageTime(message.createdAt)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {!isUser && message.operations?.length ? (
        <View style={styles.receiptWrap}>
          <AssistantActionReceipt
            operations={message.operations}
            undoing={undoing}
            undoError={undoError}
            onNavigate={onNavigate}
            onUndo={() => onUndo(message.requestId)}
          />
        </View>
      ) : null}
      {!isUser && message.errorCode === 'cancelled' ? (
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>已停止 · 未执行任何操作</Text>
        </View>
      ) : null}
      {isUser && message.status === 'failed' ? (
        canRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新发送这条消息"
            onPress={() => onRetry(message.requestId)}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryText}>{assistantFailureLabel(message, true)}</Text>
          </Pressable>
        ) : (
          <View style={styles.retry}>
            <Text style={styles.statusText}>{assistantFailureLabel(message, false)}</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  row: { width: '100%', marginVertical: 5 },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 7 },
  userBubble: { backgroundColor: theme.colors.accent, borderBottomRightRadius: 5 },
  assistantBubble: { backgroundColor: theme.colors.card, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: theme.colors.border },
  content: { color: theme.colors.text, fontSize: theme.font.body, lineHeight: 22 },
  userContent: { color: '#FFFFFF' },
  time: { color: theme.colors.textDim, fontSize: 11, marginTop: 4 },
  userTime: { color: 'rgba(255,255,255,0.72)', textAlign: 'right' },
  cursor: { color: theme.colors.accent },
  runtimeRow: { minHeight: 36, maxWidth: '86%', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 4 },
  runtimeText: { color: theme.colors.textDim, fontSize: 13 },
  statusRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, paddingHorizontal: 3 },
  statusText: { color: theme.colors.textDim, fontSize: 12 },
  retry: { minHeight: 32, justifyContent: 'center', marginTop: 2, paddingHorizontal: 4 },
  retryPressed: { opacity: 0.6 },
  retryText: { color: theme.colors.red, fontSize: 12 },
  receiptWrap: { width: '86%' },
});
