import { StyleSheet, Text, View } from 'react-native';

import { ASSISTANT_EMPTY_DESCRIPTION } from '../assistant/ui-copy';
import { theme } from '../theme';
import { XiaozhiEyesIcon } from './XiaozhiEyesIcon';

export function AssistantEmptyState() {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <XiaozhiEyesIcon size={34} focused />
      </View>
      <Text style={styles.title}>有什么想法，直接告诉小知</Text>
      <Text style={styles.description}>{ASSISTANT_EMPTY_DESCRIPTION}</Text>
      <View style={styles.examples}>
        <Text style={styles.example}>“周四晚上提醒我整理照片”</Text>
        <Text style={styles.example}>“最近这个项目总是推进不动”</Text>
        <Text style={styles.example}>“记住，我更喜欢先看结论”</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30, paddingBottom: 44 },
  iconWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { color: theme.colors.ink, fontSize: 20, lineHeight: 28, fontWeight: theme.fontWeight.semibold, textAlign: 'center' },
  description: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 300 },
  examples: { alignSelf: 'stretch', marginTop: 22, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  example: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, paddingHorizontal: 2, paddingVertical: 11 },
});
