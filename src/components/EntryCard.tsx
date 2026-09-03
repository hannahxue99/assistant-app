/**
 * 条目卡片 — 展示单条记录（待办/想法/信息）
 * 支持：待办勾选、时间展示、标签展示、轻提示"理解结果"（可纠正入口）
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Entry } from '../types';
import { KIND_META, theme } from '../theme';

interface Props {
  entry: Entry;
  onToggleDone?: (id: string, done: boolean) => void;
  onPress?: (entry: Entry) => void;
  showCorrectionHint?: boolean;
}

export function EntryCard({ entry, onToggleDone, onPress, showCorrectionHint }: Props) {
  const meta = KIND_META[entry.kind];
  const isTask = entry.kind === 'task';
  const done = !!entry.done;

  return (
    <Pressable
      onPress={() => onPress?.(entry)}
      style={[styles.card, done && styles.cardDone]}
    >
      <View style={styles.left}>
        {isTask ? (
          <Pressable
            onPress={() => onToggleDone?.(entry.id, !done)}
            style={[styles.check, done && styles.checkOn]}
            hitSlop={8}
          >
            {done && <Text style={styles.checkMark}>✓</Text>}
          </Pressable>
        ) : (
          <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        )}
      </View>

      <View style={styles.mid}>
        <Text
          numberOfLines={3}
          style={[styles.summary, done && styles.summaryDone]}
        >
          {entry.summary}
        </Text>
        <View style={styles.metaRow}>
          {entry.dueAt && (
            <Text style={[styles.due, isOverdue(entry) && styles.dueOverdue]}>
              {formatDue(entry.dueAt)}
            </Text>
          )}
          {entry.topic && <Text style={styles.topic}>#{entry.topic}</Text>}
          {entry.tags.map((t) => (
            <Text key={t} style={styles.tag}>
              {t}
            </Text>
          ))}
        </View>
      </View>

      {showCorrectionHint && entry.parseSource === 'llm' && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>理解</Text>
        </View>
      )}
    </Pressable>
  );
}

function isOverdue(e: Entry): boolean {
  return e.kind === 'task' && !e.done && !!e.dueAt && e.dueAt < Date.now();
}

function formatDue(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hh}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hh}`;
  return `${md} ${hh}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  cardDone: { opacity: 0.55 },
  left: { alignItems: 'center', paddingTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.colors.green, borderColor: theme.colors.green },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  mid: { flex: 1, gap: 6 },
  summary: { fontSize: theme.font.body, color: theme.colors.text, lineHeight: 21 },
  summaryDone: { textDecorationLine: 'line-through', color: theme.colors.textDim },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  due: { fontSize: theme.font.small, color: theme.colors.accent, fontWeight: '600' },
  dueOverdue: { color: theme.colors.red },
  topic: { fontSize: theme.font.small, color: theme.colors.gold, fontWeight: '600' },
  tag: { fontSize: theme.font.small, color: theme.colors.textDim },
  hint: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  hintText: { fontSize: 11, color: theme.colors.accent, fontWeight: '600' },
});
