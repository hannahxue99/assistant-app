import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  assistantCompletedRuntimeLabel,
  assistantRuntimeLabel,
  assistantStageLineLabel,
  assistantStageSummaryLabel,
  formatAssistantRuntimeDuration,
} from '../assistant/runtime-state';
import { formatAssistantMessageTime } from '../assistant/message-time';
import type { AssistantReasoning } from '../assistant/reasoning-store';
import { assistantFailureLabel } from '../assistant/ui-state';
import type { AssistantMessage } from '../assistant/types';
import type { AssistantRuntimeStage } from '../assistant/runtime-state';
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
  onLoadReasoning?: (requestId: string) => Promise<AssistantReasoning | null>;
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
  onLoadReasoning = async () => null,
}: AssistantMessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = !isUser && message.status === 'streaming';
  const [now, setNow] = useState(() => Date.now());
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [loadedReasoning, setLoadedReasoning] = useState<AssistantReasoning | null>(null);
  const [reasoningLoading, setReasoningLoading] = useState(false);
  const [reasoningError, setReasoningError] = useState(false);
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
  const reasoningText = message.reasoningContent ?? loadedReasoning?.content ?? '';
  const reasoningStartedAt = message.reasoningStartedAt ?? loadedReasoning?.startedAt;
  const reasoningCompletedAt = message.reasoningCompletedAt ?? loadedReasoning?.completedAt;
  const hasReasoning = !isUser && Boolean(message.reasoningAvailable || reasoningText);
  const reasoningDuration = reasoningStartedAt !== undefined && reasoningCompletedAt !== undefined
    ? formatAssistantRuntimeDuration(Math.max(0, reasoningCompletedAt - reasoningStartedAt))
    : null;

  async function toggleReasoning() {
    if (reasoningExpanded) {
      setReasoningExpanded(false);
      return;
    }
    setReasoningExpanded(true);
    if (reasoningText || reasoningLoading || !message.reasoningAvailable) return;
    setReasoningLoading(true);
    setReasoningError(false);
    try {
      const loaded = await onLoadReasoning(message.requestId);
      setLoadedReasoning(loaded);
      if (!loaded) setReasoningError(true);
    } catch {
      setReasoningError(true);
    } finally {
      setReasoningLoading(false);
    }
  }

  const runtimeStage = message.runtimeStage ?? 'planning';
  // 运行中逐行累加：同阶段多段合并耗时，已定格的行不带转圈。
  const completedStageLines = (message.stageSegments ?? [])
    .slice(0, -1)
    .reduce<Array<{ stage: AssistantRuntimeStage; ms: number }>>((acc, segment, index, all) => {
      const next = all[index + 1];
      const ms = Math.max(0, (next?.startedAt ?? segment.endedAt ?? 0) - segment.startedAt);
      const existing = acc.find(item => item.stage === segment.stage);
      if (existing) {
        existing.ms += ms;
        return acc;
      }
      acc.push({ stage: segment.stage, ms });
      return acc;
    }, [])
    .filter(item => item.ms >= 1000);
  const finalSummaryLabel = !isUser && !isStreaming
    ? assistantStageSummaryLabel(
      message.stageDurations,
      reasoningStartedAt !== undefined && reasoningCompletedAt !== undefined
        ? reasoningCompletedAt - reasoningStartedAt
        : undefined,
    )
    : null;
  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.assistantRow]}>
      {isStreaming && completedStageLines.length > 0 ? (
        <View style={styles.stageLinesWrap} accessibilityLabel="已完成的处理阶段">
          {completedStageLines.map(line => (
            <Text key={line.stage} style={styles.stageLine}>{assistantStageLineLabel(line.stage, line.ms)}</Text>
          ))}
        </View>
      ) : null}
      {hasReasoning ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: reasoningExpanded }}
          accessibilityLabel={reasoningExpanded ? '收起思考过程' : '展开思考过程'}
          onPress={() => { void toggleReasoning(); }}
          style={({ pressed }) => [styles.reasoningHeader, pressed && styles.retryPressed]}
        >
          {isStreaming ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : null}
          <Text style={styles.reasoningHeaderText}>
            {isStreaming && startedAt !== undefined
              ? assistantRuntimeLabel(runtimeStage, elapsedMs)
              : finalSummaryLabel ?? `思考了 ${reasoningDuration ?? formatAssistantRuntimeDuration(elapsedMs)}`}
          </Text>
          <Text style={styles.reasoningChevron}>{reasoningExpanded ? '⌃' : '›'}</Text>
        </Pressable>
      ) : isStreaming && startedAt !== undefined ? (
        <View accessibilityLabel={assistantRuntimeLabel(runtimeStage, elapsedMs)} style={styles.runtimeRow}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.runtimeText}>{assistantRuntimeLabel(runtimeStage, elapsedMs)}</Text>
        </View>
      ) : null}
      {hasReasoning && reasoningExpanded ? (
        <View style={styles.reasoningBody}>
          {reasoningLoading ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
          {reasoningText ? <Text selectable style={styles.reasoningText}>{reasoningText}</Text> : null}
          {reasoningError ? <Text style={styles.reasoningError}>思考过程暂时无法加载</Text> : null}
          {reasoningText ? <Text style={styles.reasoningNote}>模型生成的思考过程，仅供参考</Text> : null}
        </View>
      ) : null}
      {message.content ? (
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text selectable style={[styles.content, isUser && styles.userContent]}>
            {message.content}{isStreaming ? <Text style={styles.cursor}>▋</Text> : null}
          </Text>
          {!isStreaming ? (
            <Text style={[styles.time, isUser && styles.userTime]}>
              {completedRuntime ? `${completedRuntime} · ` : ''}{formatAssistantMessageTime(message.createdAt)}
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
  reasoningHeader: { minHeight: 38, maxWidth: '86%', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 19, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 4 },
  reasoningHeaderText: { flexShrink: 1, color: theme.colors.textDim, fontSize: 13 },
  reasoningChevron: { color: theme.colors.textDim, fontSize: 18, lineHeight: 20 },
  reasoningBody: { width: '86%', gap: 8, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 16, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 5 },
  reasoningText: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20 },
  reasoningNote: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  reasoningError: { color: theme.colors.red, fontSize: 12 },
  stageLinesWrap: { maxWidth: '86%', gap: 3, paddingHorizontal: 12, marginBottom: 3 },
  stageLine: { color: theme.colors.textDim, fontSize: 12 },
  statusRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, paddingHorizontal: 3 },
  statusText: { color: theme.colors.textDim, fontSize: 12 },
  retry: { minHeight: 32, justifyContent: 'center', marginTop: 2, paddingHorizontal: 4 },
  retryPressed: { opacity: 0.6 },
  retryText: { color: theme.colors.red, fontSize: 12 },
  receiptWrap: { width: '86%' },
});
