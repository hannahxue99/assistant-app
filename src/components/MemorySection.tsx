import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { canSaveMemoryEdit, type MemorySectionState } from '../assistant/memory-ui';
import { ASSISTANT_MEMORY_CATEGORY_LABELS, type AssistantMemory } from '../assistant/memory-types';
import { theme } from '../theme';

interface Props {
  state: MemorySectionState;
  memories: AssistantMemory[];
  summary: string;
  busyId: string | null;
  onRetry: () => void;
  onSave: (memory: AssistantMemory, content: string) => Promise<void>;
  onForget: (memory: AssistantMemory) => Promise<void>;
}

function SkeletonCard() {
  return <View style={[styles.card, styles.skeletonCard]}>
    <View style={[styles.skeletonLine, styles.skeletonLabel]} />
    <View style={[styles.skeletonLine, styles.skeletonContent]} />
    <View style={[styles.skeletonLine, styles.skeletonShort]} />
  </View>;
}

export function MemorySection({ state, memories, summary, busyId, onRetry, onSave, onForget }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelEdit = () => { setEditingId(null); setDraft(''); };

  async function save(memory: AssistantMemory) {
    if (!canSaveMemoryEdit(memory.content, draft, busyId === memory.id)) return;
    await onSave(memory, draft.trim().replace(/\s+/g, ' '));
    cancelEdit();
  }

  return <View style={styles.section}>
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>长期记忆</Text>
      <Text style={styles.summary}>{summary}</Text>
    </View>
    {state === 'loading' && <View style={styles.list}>{[0, 1, 2].map(item => <SkeletonCard key={item} />)}</View>}
    {state === 'error' && <View style={styles.stateCard}>
      <Ionicons name="cloud-offline-outline" size={24} color={theme.colors.textDim} />
      <Text style={styles.stateTitle}>长期记忆暂时没有载入</Text>
      <Text style={styles.stateCopy}>下方设置仍可正常使用。</Text>
      <Pressable accessibilityRole="button" style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryText}>重试</Text>
      </Pressable>
    </View>}
    {state === 'empty' && <View style={styles.stateCard}>
      <View style={styles.emptyIcon}><Ionicons name="sparkles-outline" size={22} color={theme.colors.accent} /></View>
      <Text style={styles.stateTitle}>还没有长期记忆</Text>
      <Text style={styles.stateCopy}>可以直接告诉小知：“记住，我……”</Text>
    </View>}
    {state === 'ready' && <View style={styles.list}>{memories.map(memory => {
      const editing = editingId === memory.id;
      const busy = busyId === memory.id;
      const saveEnabled = canSaveMemoryEdit(memory.content, draft, busy);
      return <View key={memory.id} style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.category}>{ASSISTANT_MEMORY_CATEGORY_LABELS[memory.category]}</Text>
          {!editing && <View style={styles.cardActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`修改${memory.content}`}
              disabled={busy}
              hitSlop={8}
              onPress={() => { setEditingId(memory.id); setDraft(memory.content); }}
              style={styles.iconAction}
            ><Ionicons name="create-outline" size={18} color={theme.colors.textDim} /></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`忘记${memory.content}`}
              disabled={busy}
              hitSlop={8}
              onPress={() => void onForget(memory)}
              style={styles.iconAction}
            >{busy ? <ActivityIndicator size="small" color={theme.colors.textDim} />
              : <Ionicons name="trash-outline" size={17} color={theme.colors.textDim} />}</Pressable>
          </View>}
        </View>
        {editing ? <>
          <TextInput
            autoFocus multiline maxLength={200} value={draft} onChangeText={setDraft}
            style={styles.input} placeholderTextColor={theme.colors.textDim}
          />
          <View style={styles.editActions}>
            <Pressable disabled={busy} onPress={cancelEdit} style={styles.textButton}><Text style={styles.cancelText}>取消</Text></Pressable>
            <Pressable
              disabled={!saveEnabled} onPress={() => void save(memory)}
              style={[styles.saveButton, !saveEnabled && styles.disabled]}
            >{busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveText}>保存</Text>}</Pressable>
          </View>
        </> : <Text style={styles.content}>{memory.content}</Text>}
      </View>;
    })}</View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 7, marginTop: 2 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  sectionTitle: { color: theme.colors.text, fontSize: theme.font.heading, fontWeight: '700' },
  summary: { color: theme.colors.textDim, fontSize: 12 },
  list: { gap: 6 },
  card: { backgroundColor: theme.colors.card, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, paddingVertical: 9, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  category: { color: theme.colors.accent, fontSize: 12, fontWeight: '600' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconAction: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  content: { color: theme.colors.text, fontSize: theme.font.body, lineHeight: 21 },
  input: { minHeight: 68, borderRadius: 10, borderWidth: 1.5, borderColor: theme.colors.accent, backgroundColor: theme.colors.bg, paddingHorizontal: 11, paddingVertical: 9, color: theme.colors.text, fontSize: theme.font.body, lineHeight: 21, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  textButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11 },
  cancelText: { color: theme.colors.textDim, fontSize: theme.font.small },
  saveButton: { minWidth: 66, minHeight: 38, borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#fff', fontSize: theme.font.small, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  stateCard: { minHeight: 124, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.card, alignItems: 'center', justifyContent: 'center', padding: 14, gap: 5 },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { color: theme.colors.text, fontSize: theme.font.body, fontWeight: '600', marginTop: 2 },
  stateCopy: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 16, marginTop: 3 },
  retryText: { color: theme.colors.accent, fontSize: theme.font.small, fontWeight: '600' },
  skeletonCard: { height: 78, justifyContent: 'center' },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: theme.colors.border },
  skeletonLabel: { width: 52 },
  skeletonContent: { width: '88%', marginTop: 4 },
  skeletonShort: { width: '58%' },
});
