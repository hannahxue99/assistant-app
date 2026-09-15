import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
}

export function AssistantMessageBubble({
  message,
  onRetry,
  canRetry = false,
  onNavigate = () => {},
  onUndo = () => {},
  undoing = false,
  undoError = null,
}: AssistantMessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.content, isUser && styles.userContent]}>{message.content}</Text>
        <Text style={[styles.time, isUser && styles.userTime]}>{formatMessageTime(message.createdAt)}</Text>
      </View>
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
      {isUser && message.status === 'sending' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={theme.colors.textDim} />
          <Text style={styles.statusText}>小知正在想…</Text>
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
  statusRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, paddingHorizontal: 3 },
  statusText: { color: theme.colors.textDim, fontSize: 12 },
  retry: { minHeight: 32, justifyContent: 'center', marginTop: 2, paddingHorizontal: 4 },
  retryPressed: { opacity: 0.6 },
  retryText: { color: theme.colors.red, fontSize: 12 },
  receiptWrap: { width: '86%' },
});
