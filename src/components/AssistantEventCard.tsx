import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AssistantEvent } from '../assistant/action-types';
import { logTimestamp } from '../engine/schedule';
import { theme } from '../theme';

export function AssistantEventCard({
  event,
  onPress,
}: {
  event: AssistantEvent;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看事件${event.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, event.pinnedAt !== null && styles.pinned, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <View style={styles.titleRow}>
          {event.pinnedAt !== null ? <Ionicons name="pin" size={14} color={theme.colors.gold} /> : null}
          <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
        </View>
        <Text style={styles.time}>{logTimestamp(event.updatedAt)}</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} />
      </View>
      {event.currentState ? <Text style={styles.state} numberOfLines={1}>{event.currentState}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 4,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  pinned: { borderColor: '#E2C77F', backgroundColor: '#FFFCF3' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, color: theme.colors.text, fontSize: theme.font.body, fontWeight: theme.fontWeight.semibold },
  state: { color: theme.colors.text, fontSize: theme.font.small, lineHeight: 18 },
  time: { color: theme.colors.textDim, fontSize: 11 },
  pressed: { opacity: 0.68 },
});
