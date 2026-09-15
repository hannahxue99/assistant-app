import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AssistantEvent } from '../assistant/action-types';
import { logTimestamp } from '../engine/schedule';
import { theme } from '../theme';
import { TopicPinIcon } from './TopicPinIcon';

export function AssistantEventCard({
  event,
  onPress,
  onTogglePin,
  pinning = false,
}: {
  event: AssistantEvent;
  onPress: () => void;
  onTogglePin: () => void;
  pinning?: boolean;
}) {
  return (
    <View style={[styles.card, event.pinnedAt !== null && styles.pinned]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看事件${event.title}`}
        onPress={onPress}
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
      >
        <Text style={styles.title} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.state} numberOfLines={1}>
          {event.currentState || '暂时还没有明确进展'}
        </Text>
        <Text style={styles.time}>{logTimestamp(event.updatedAt)}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: event.pinnedAt !== null, disabled: pinning }}
        accessibilityLabel={event.pinnedAt !== null ? `取消置顶${event.title}` : `置顶${event.title}`}
        disabled={pinning}
        onPress={onTogglePin}
        style={({ pressed }) => [styles.pinButton, (pressed || pinning) && styles.pinPressed]}
      >
        <TopicPinIcon pinned={event.pinnedAt !== null} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  pinned: { borderColor: '#E2C77F', backgroundColor: '#FFFCF3' },
  content: { paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  title: { color: theme.colors.text, fontSize: 17, lineHeight: 23, fontWeight: theme.fontWeight.semibold, paddingRight: 38 },
  state: { color: theme.colors.text, fontSize: theme.font.small, lineHeight: 19, paddingRight: 20 },
  time: { color: theme.colors.textDim, fontSize: 11, lineHeight: 16 },
  pinButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  pinPressed: { opacity: 0.45 },
  pressed: { opacity: 0.68 },
});
