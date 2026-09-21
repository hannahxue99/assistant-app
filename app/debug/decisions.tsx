/**
 * 决策日志调试页 — 仅开发构建可达的内部工具
 * 展示每轮请求的执行结果、工具调用轨迹、叙述来源与错误原因，
 * 用于在设备上直接回溯“小知为什么这么说”，无需拉取数据库。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAssistantDecisionLog, type AssistantDecisionLog } from '../../src/assistant/decision-log';
import { listMessages } from '../../src/assistant/store';
import { theme } from '../../src/theme';

interface DecisionRow {
  requestId: string;
  createdAt: number;
  userPreview: string;
  log: AssistantDecisionLog | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  committed: '已提交',
  rejected: '已拒绝',
  no_change: '无写入',
  failed: '执行失败',
  pending: '待执行',
};

const NARRATION_LABELS: Record<string, string> = {
  model: '模型生成',
  fallback: '本地兜底',
  skipped: '未走叙述',
};

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export default function DecisionLogScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const messages = await listMessages({ limit: 100 });
        const requestIds = [...new Set(messages.map(item => item.requestId))].slice(0, 30);
        const previews = new Map<string, string>();
        for (const message of messages) {
          if (message.role === 'user' && !previews.has(message.requestId)) {
            previews.set(message.requestId, message.content.slice(0, 60));
          }
        }
        const loaded = await Promise.all(requestIds.map(async requestId => ({
          requestId,
          createdAt: messages.find(item => item.requestId === requestId)?.createdAt ?? 0,
          userPreview: previews.get(requestId) ?? '',
          log: await getAssistantDecisionLog(requestId),
        })));
        setRows(loaded.filter(row => row.log || row.userPreview));
      })().catch(() => setRows([]));
    }, []),
  );

  if (rows === null) return null;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ 小知</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>决策日志</Text>
        <Text style={styles.desc}>开发调试工具：按请求回放工具调用、校验拒绝与最终回复来源。</Text>
        {rows.length === 0 ? <Text style={styles.empty}>暂无记录</Text> : null}
        {rows.map(row => {
          const log = row.log;
          const key = `${row.requestId}:${row.createdAt}`;
          const isExpanded = expanded === key;
          const toolCalls = log?.toolCalls ?? [];
          const rejections = log?.executionRejected ?? [];
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`查看请求 ${row.requestId} 的决策详情`}
              onPress={() => setExpanded(isExpanded ? null : key)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTime}>{formatTime(row.createdAt)}</Text>
                <View style={styles.badges}>
                  {log ? (
                    <>
                      <Text style={[styles.badge, log.status === 'failed' ? styles.badgeBad : styles.badgeOk]}>
                        {log.status}
                      </Text>
                      <Text style={styles.badge}>{OUTCOME_LABELS[log.executionOutcome] ?? log.executionOutcome}</Text>
                      {log.protocolWarnings.length ? (
                        <Text style={[styles.badge, styles.badgeWarn]}>{log.protocolWarnings.join(',')}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.badge}>无日志</Text>
                  )}
                </View>
              </View>
              {row.userPreview ? <Text style={styles.userPreview} numberOfLines={1}>{row.userPreview}</Text> : null}
              {log?.errorCode ? (
                <Text style={styles.errorText} numberOfLines={2}>{log.errorCode}：{log.errorDetail ?? ''}</Text>
              ) : null}
              {isExpanded && log ? (
                <View style={styles.detail}>
                  <Text style={styles.sectionTitle}>工具调用（{toolCalls.length}）</Text>
                  {toolCalls.length === 0 ? <Text style={styles.muted}>未调用</Text> : null}
                  {toolCalls.map((call, index) => (
                    <Text key={index} style={call.ok === false ? styles.toolFail : styles.toolLine}>
                      {`${index + 1}. ${String(call.name ?? '')} ${String(call.summary ?? '')}${call.ok === false ? ` ← ${String(call.errorCode ?? '')}` : ''}`}
                    </Text>
                  ))}
                  <Text style={styles.sectionTitle}>精确读取</Text>
                  <Text style={styles.muted}>
                    {`事件 ${log.toolReadEventIds.length}｜待办 ${log.toolReadTodoIds.length}｜记忆 ${log.toolReadMemoryIds.length}`}
                  </Text>
                  <Text style={styles.sectionTitle}>执行拒绝（{rejections.length}）</Text>
                  {rejections.length === 0 ? <Text style={styles.muted}>无</Text> : null}
                  {rejections.map((item, index) => (
                    <Text key={index} style={styles.toolFail}>
                      {`${String(item.type ?? '')}：${String(item.reason ?? '')}${item.detail ? `（${String(item.detail)}）` : ''}`}
                    </Text>
                  ))}
                  <Text style={styles.sectionTitle}>最终回复来源</Text>
                  <Text style={styles.muted}>
                    {log.narration && typeof log.narration.source === 'string'
                      ? `${NARRATION_LABELS[log.narration.source] ?? log.narration.source}${log.narration.errorCode ? `（${log.narration.errorCode}）` : ''}`
                      : '未记录'}
                  </Text>
                  <Text style={styles.sectionTitle}>原始 JSON</Text>
                  <Text style={styles.json}>{JSON.stringify(log, null, 2).slice(0, 4000)}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { paddingHorizontal: 16, paddingVertical: 8 },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  h1: { color: theme.colors.text, fontSize: theme.font.title, fontWeight: theme.fontWeight.semibold },
  desc: { color: theme.colors.textDim, fontSize: theme.font.small, marginBottom: 4 },
  empty: { color: theme.colors.textDim, fontSize: theme.font.body },
  card: { borderRadius: 12, backgroundColor: theme.colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, padding: 12, gap: 6 },
  cardPressed: { opacity: 0.75 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTime: { color: theme.colors.textDim, fontSize: 12 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { color: theme.colors.textDim, fontSize: 11, backgroundColor: theme.colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  badgeOk: { color: '#2e7d32', backgroundColor: '#e8f5e9' },
  badgeBad: { color: '#c62828', backgroundColor: '#ffebee' },
  badgeWarn: { color: '#9a6b00', backgroundColor: '#fff8e1' },
  userPreview: { color: theme.colors.text, fontSize: theme.font.body },
  errorText: { color: '#c62828', fontSize: theme.font.small },
  detail: { gap: 4, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 8 },
  sectionTitle: { color: theme.colors.text, fontSize: 12, fontWeight: theme.fontWeight.semibold, marginTop: 6 },
  muted: { color: theme.colors.textDim, fontSize: 12 },
  toolLine: { color: theme.colors.textDim, fontSize: 11 },
  toolFail: { color: '#c62828', fontSize: 11 },
  json: { color: theme.colors.textDim, fontSize: 10, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
