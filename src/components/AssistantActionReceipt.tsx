import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AssistantOperation } from '../assistant/action-types';
import { assistantReceiptState } from '../assistant/ui-state';
import { theme } from '../theme';

interface AssistantActionReceiptProps {
  operations: AssistantOperation[];
  undoing?: boolean;
  undoError?: string | null;
  onNavigate: (target: string) => void;
  onUndo: () => void;
}

function iconName(operation: AssistantOperation): keyof typeof Ionicons.glyphMap {
  if (operation.operationType === 'delete_todo' || operation.operationType === 'delete_event') return 'trash-outline';
  if (operation.objectType === 'todo') return operation.operationType === 'complete_todo'
    ? 'checkmark-circle-outline' : 'checkbox-outline';
  if (operation.objectType === 'event_update') return 'pulse-outline';
  if (operation.objectType === 'relation') return 'link-outline';
  return 'git-branch-outline';
}

export function AssistantActionReceipt({
  operations,
  undoing = false,
  undoError,
  onNavigate,
  onUndo,
}: AssistantActionReceiptProps) {
  const state = assistantReceiptState(operations);
  if (!state.visible) return null;
  const allUndone = state.operations.every(operation => operation.status === 'undone');

  return (
    <View style={styles.card} accessibilityLabel="小知已处理事项">
      <View style={styles.header}>
        <View style={styles.headerLabel}>
          <Ionicons name={allUndone ? 'arrow-undo-outline' : 'sparkles-outline'} size={16} color={theme.colors.accent} />
          <Text style={styles.title}>{allUndone ? '已撤销' : '已处理'}</Text>
        </View>
        {state.canUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="撤销本轮处理"
            disabled={undoing}
            onPress={onUndo}
            hitSlop={7}
            style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}
          >
            {undoing ? <ActivityIndicator size="small" color={theme.colors.textDim} /> : (
              <Text style={styles.undoText}>撤销本轮</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {state.groups.map((group, index) => {
        const operation = group.primaryOperation;
        const target = group.target;
        return (
          <Pressable
            key={group.key}
            accessibilityRole={target ? 'button' : undefined}
            accessibilityLabel={group.summaries.join('，')}
            disabled={!target}
            hitSlop={target ? 4 : undefined}
            onPress={() => { if (target) onNavigate(target); }}
            style={({ pressed }) => [styles.row, index > 0 && styles.rowSpacing, pressed && target && styles.pressed]}
          >
            <Ionicons
              name={iconName(operation)}
              size={18}
              color={operation.status === 'undone' ? theme.colors.textDim : theme.colors.green}
            />
            <View style={styles.summaryWrap}>
              {group.summaries.map(summary => (
                <Text key={summary} style={[styles.summary, group.undone && styles.undone]} numberOfLines={1}>
                  {summary}
                </Text>
              ))}
            </View>
            {target ? <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} /> : null}
          </Pressable>
        );
      })}

      {undoError ? <Text style={styles.error}>{undoError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    marginTop: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECDCCF',
    backgroundColor: '#FFF9F4',
  },
  header: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: theme.colors.text, fontSize: theme.font.small, fontWeight: theme.fontWeight.semibold },
  undoButton: { minHeight: 26, minWidth: 72, alignItems: 'flex-end', justifyContent: 'center' },
  undoText: { color: theme.colors.textDim, fontSize: 12 },
  row: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowSpacing: { marginTop: 2 },
  summaryWrap: { flex: 1, paddingVertical: 1, gap: 0 },
  summary: { color: theme.colors.text, fontSize: theme.font.small, lineHeight: 18 },
  undone: { color: theme.colors.textDim, textDecorationLine: 'line-through' },
  error: { color: theme.colors.red, fontSize: 12, lineHeight: 16, paddingTop: 2 },
  pressed: { opacity: 0.65 },
});
