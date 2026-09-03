/**
 * 理解引擎子页 — 我的页唯一的 stack 设置页
 * LLM 开关 + API 地址 / 模型名 / API Key + 保存；关闭即纯规则模式
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSettings, saveSettings } from '../../src/db';
import type { Settings } from '../../src/types';
import { theme } from '../../src/theme';

export default function LlmSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => setSettings(await getSettings()))();
    }, []),
  );

  if (!settings) return null;
  const s = settings;

  async function handleSave() {
    if (s.llmEnabled && !s.llmKey.trim()) {
      Alert.alert('未配置 API Key', '开关打开但 Key 为空，理解将退回纯规则模式。', [
        { text: '仍要保存', onPress: () => persist() },
        { text: '去填写', style: 'cancel' },
      ]);
      return;
    }
    await persist();
  }

  async function persist() {
    await saveSettings(s);
    Alert.alert('已保存', '理解引擎将使用新的配置。', [{ text: '好', onPress: () => router.back() }]);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ 我的</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>理解引擎</Text>
        <Text style={styles.desc}>让口语化的随手记被整理成待办、想法和信息。关掉开关即退回纯规则模式，原文照记。</Text>

        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>启用 LLM 理解</Text>
          <Switch
            value={s.llmEnabled}
            onValueChange={(v) => setSettings({ ...s, llmEnabled: v })}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
            thumbColor={s.llmEnabled ? theme.colors.accent : '#fff'}
          />
        </View>

        {s.llmEnabled && (
          <>
            <Text style={styles.label}>API 地址（OpenAI 兼容）</Text>
            <TextInput
              style={styles.input}
              value={s.llmBaseUrl}
              onChangeText={(v) => setSettings({ ...s, llmBaseUrl: v })}
              placeholder="https://api.deepseek.com/v1"
              placeholderTextColor={theme.colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>模型名</Text>
            <TextInput
              style={styles.input}
              value={s.llmModel}
              onChangeText={(v) => setSettings({ ...s, llmModel: v })}
              placeholder="deepseek-chat"
              placeholderTextColor={theme.colors.textDim}
              autoCapitalize="none"
            />
            <Text style={styles.label}>API Key（仅存在本机）</Text>
            <TextInput
              style={styles.input}
              value={s.llmKey}
              onChangeText={(v) => setSettings({ ...s, llmKey: v })}
              placeholder="sk-..."
              placeholderTextColor={theme.colors.textDim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}

        <Pressable style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>保存</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  top: { paddingHorizontal: 16, paddingVertical: 8 },
  back: { fontSize: theme.font.body, color: theme.colors.accent },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  desc: { fontSize: theme.font.small, color: theme.colors.textDim, lineHeight: 19 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  rowLabel: { fontSize: theme.font.body, color: theme.colors.text },
  label: { fontSize: theme.font.small, color: theme.colors.textDim, marginTop: 4 },
  input: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: theme.font.body,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  saveBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.input,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
});
