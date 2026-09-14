import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

export function AssistantEmptyState() {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="robot-happy-outline" size={34} color={theme.colors.accent} />
      </View>
      <Text style={styles.title}>有什么想法，直接告诉小知</Text>
      <Text style={styles.description}>不用先区分记录、待办还是困惑，我会在对话里和你一起理清。</Text>
      <View style={styles.examples}>
        <Text style={styles.example}>“周四晚上提醒我整理照片”</Text>
        <Text style={styles.example}>“最近这个项目总是推进不动”</Text>
        <Text style={styles.example}>“记住，我更喜欢先看结论”</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30, paddingBottom: 50 },
  iconWrap: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft, marginBottom: 18 },
  title: { color: theme.colors.text, fontSize: theme.font.heading, fontWeight: theme.fontWeight.semibold, textAlign: 'center' },
  description: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 300 },
  examples: { alignSelf: 'stretch', gap: 8, marginTop: 22 },
  example: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20, backgroundColor: theme.colors.card, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: 12, paddingVertical: 9 },
});
