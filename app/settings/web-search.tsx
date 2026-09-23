import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { webSearchSettingsState } from '../../src/assistant/web-search';
import { getSettings, saveSettings } from '../../src/db';
import { theme } from '../../src/theme';
import type { Settings } from '../../src/types';

export default function WebSearchSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);

  useFocusEffect(useCallback(() => {
    void getSettings().then(setSettings);
  }, []));

  if (!settings) return null;
  const enabled = settings.webSearchEnabled !== false;
  const state = webSearchSettingsState(settings);
  const unavailable = enabled && state.status !== 'ready';
  const unavailableCopy = state.status === 'engine-disabled'
    ? '理解引擎已关闭，联网搜索暂不可用。'
    : state.status === 'missing-key'
      ? '请先在“理解引擎”中配置 API Key。'
      : state.status === 'unsupported'
        ? '当前仅支持 DeepSeek 官方 API 地址。'
        : '';

  async function persist() {
    await saveSettings(settings as Settings);
    Alert.alert('已保存', '联网搜索设置已更新。', [{ text: '好', onPress: () => router.back() }]);
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ 我的</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>联网搜索</Text>
        <Text style={styles.desc}>
          遇到最新信息或小知不确定的外部知识时，由 DeepSeek 自动决定是否搜索网页。搜索次数和读取范围由 DeepSeek 服务端自行判断。
        </Text>

        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.rowLabel}>允许小知联网搜索</Text>
            <Text style={styles.rowHint}>关闭后，小知只使用本地上下文和模型已有知识。</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={value => setSettings({ ...settings, webSearchEnabled: value })}
            trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
            thumbColor={enabled ? theme.colors.accent : '#fff'}
          />
        </View>

        {unavailable ? <Text style={styles.warning}>{unavailableCopy}</Text> : null}

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>使用方式</Text>
          <Text style={styles.note}>• 小知会自动判断是否需要联网，不需要手动选择模式。</Text>
          <Text style={styles.note}>• 回答下方会显示本次搜索来源，可展开查看并打开网页。</Text>
          <Text style={styles.note}>• 网页内容不会直接创建待办、修改事件或写入长期记忆。</Text>
          <Text style={styles.note}>• 联网失败时，小知会明确说明，不会把旧知识当作实时结果。</Text>
        </View>

        <Pressable style={styles.saveBtn} onPress={() => { void persist(); }}>
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
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  desc: { fontSize: theme.font.small, color: theme.colors.textDim, lineHeight: 20 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.input, paddingHorizontal: 14, paddingVertical: 12,
  },
  switchCopy: { flex: 1, gap: 4 },
  rowLabel: { fontSize: theme.font.body, color: theme.colors.text },
  rowHint: { fontSize: 12, lineHeight: 17, color: theme.colors.textDim },
  warning: { color: theme.colors.red, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
  noteCard: { gap: 7, padding: 14, borderRadius: theme.radius.input, backgroundColor: theme.colors.accentSoft },
  noteTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  note: { color: theme.colors.textDim, fontSize: 12, lineHeight: 18 },
  saveBtn: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.input, paddingVertical: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: theme.font.body },
});
