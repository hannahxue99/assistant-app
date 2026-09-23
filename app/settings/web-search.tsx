import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSettings, saveSettings } from '../../src/db';
import { theme } from '../../src/theme';
import type { Settings } from '../../src/types';

export default function WebSearchSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    void getSettings().then(setSettings);
  }, []));

  if (!settings) return null;
  const currentSettings: Settings = settings;
  const enabled = currentSettings.webSearchEnabled !== false;

  async function toggle(value: boolean) {
    const previous = currentSettings;
    const next: Settings = { ...currentSettings, webSearchEnabled: value };
    setSettings(next);
    setSaving(true);
    try {
      await saveSettings(next);
    } catch {
      setSettings(previous);
      Alert.alert('保存失败', '请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ 我的</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <Text style={styles.h1}>联网搜索</Text>
        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>允许小知联网搜索</Text>
          <Switch
            value={enabled}
            disabled={saving}
            onValueChange={value => { void toggle(value); }}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
            thumbColor={enabled ? theme.colors.accent : '#fff'}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { paddingHorizontal: 16, paddingVertical: 8 },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.input, paddingHorizontal: 14, paddingVertical: 12,
  },
  rowLabel: { fontSize: theme.font.body, color: theme.colors.text },
});
