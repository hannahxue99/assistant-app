import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

interface AssistantLoadErrorStateProps {
  retrying: boolean;
  onRetry: () => void;
}

export function AssistantLoadErrorState({ retrying, onRetry }: AssistantLoadErrorStateProps) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="database-alert-outline" size={32} color={theme.colors.accent} />
      </View>
      <Text style={styles.title}>对话暂时无法加载</Text>
      <Text style={styles.description}>你的记录仍保存在本机，请重新尝试。</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重新加载对话"
        disabled={retrying}
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, retrying && styles.disabled]}
      >
        {retrying ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>重新加载</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, paddingBottom: 48 },
  iconWrap: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft, marginBottom: 18 },
  title: { color: theme.colors.text, fontSize: theme.font.heading, fontWeight: theme.fontWeight.semibold, textAlign: 'center' },
  description: { color: theme.colors.textDim, fontSize: theme.font.small, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  button: { minWidth: 132, minHeight: 46, marginTop: 24, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent, paddingHorizontal: 18 },
  buttonText: { color: '#FFFFFF', fontSize: theme.font.body, fontWeight: theme.fontWeight.semibold },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.55 },
});
