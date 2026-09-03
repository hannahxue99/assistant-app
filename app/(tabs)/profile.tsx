/**
 * 「我的」页 — 主人页头 + 画像卡（原地编辑）+ 行内提醒开关 + 导出 + 统计 + 理解引擎入口
 * 设计：不开子页（理解引擎除外）；统计纯展示；导出直接调系统分享面板
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EditAction } from '../../src/components/EditAction';
import {
  countEntries,
  exportMarkdown,
  firstEntryAt,
  getProfile,
  getSettings,
  saveProfile,
} from '../../src/db';
import { ensurePermissions, scheduleDailyNotifications } from '../../src/engine/notifications';
import type { Profile, Settings } from '../../src/types';
import { theme } from '../../src/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [total, setTotal] = useState(0);
  const [days, setDays] = useState(0);
  const [editing, setEditing] = useState(false);
  const [goalsText, setGoalsText] = useState('');
  const [avoidText, setAvoidText] = useState('');

  const load = useCallback(async () => {
    const [s, p, n, first] = await Promise.all([getSettings(), getProfile(), countEntries(), firstEntryAt()]);
    setSettings(s);
    setProfile(p);
    setTotal(n);
    setDays(first ? Math.max(1, Math.floor((Date.now() - first) / 86400000) + 1) : 0);
    setGoalsText(p.goals.join('；'));
    setAvoidText(p.avoid.join('；'));
    setEditing(false); // 未保存的编辑在离开/重进时丢弃
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!settings || !profile) return null;

  async function saveImage() {
    const goals = goalsText.split(/[；;，,]/).map((s) => s.trim()).filter(Boolean);
    const avoid = avoidText.split(/[；;，,]/).map((s) => s.trim()).filter(Boolean);
    const next = { ...profile!, goals, avoid };
    await saveProfile(next);
    setProfile(next);
    setEditing(false);
  }

  async function toggleNotify(key: 'notifyMorning' | 'notifyEvening', v: boolean) {
    const prev = profile!;
    const next = { ...prev, [key]: v };
    setProfile(next);
    await saveProfile(next);
    if (v) {
      // 打开开关时确认/请求通知权限（首次授权弹窗在这里出现）
      const granted = await ensurePermissions();
      if (!granted) {
        setProfile(prev);
        await saveProfile(prev);
        Alert.alert('通知未授权', '请在系统设置 → 通知 中允许「私人助手」，然后重新打开开关。');
        return;
      }
    }
    await scheduleDailyNotifications();
  }

  async function doExport() {
    try {
      const md = await exportMarkdown();
      // 写成 .md 文件再分享：微信等应用不接受纯文本分享，文件形式全平台可用
      const stamp = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.cacheDirectory}主人的备忘录-${stamp}.md`;
      await FileSystem.writeAsStringAsync(uri, md);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/markdown',
          dialogTitle: '导出数据',
          UTI: 'public.text',
        });
      } else {
        await Share.share({ message: md, title: '主人的备忘录' });
      }
    } catch (e: any) {
      Alert.alert('导出失败', String(e?.message ?? e));
    }
  }

  const llmStatus = !settings.llmEnabled
    ? { label: '已关闭', warn: false }
    : settings.llmKey
      ? { label: '已开启', warn: false }
      : { label: '未配置', warn: true };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>主人</Text>
        <Text style={styles.companion}>
          {total > 0 ? `已陪伴 ${days} 天 · 共 ${total} 条记录` : '还没有记录，去首页说第一句话吧'}
        </Text>

        {/* 画像卡 */}
        <View style={styles.profileCard}>
          <View style={styles.profileHead}>
            <Text style={styles.cardTitle}>画像 · 让助手更懂你</Text>
            <EditAction
              editing={editing}
              level="module"
              onPress={editing ? saveImage : () => setEditing(true)}
              label="编辑画像"
            />
          </View>
          {editing ? (
            <>
              <Text style={styles.label}>近期目标</Text>
              <TextInput
                style={[styles.input, styles.inputEditing]}
                value={goalsText}
                onChangeText={setGoalsText}
                placeholder="如：学英语；每周跑步两次；读完三本书"
                placeholderTextColor={theme.colors.textDim}
                multiline
              />
              <Text style={styles.label}>想少做的事</Text>
              <TextInput
                style={styles.input}
                value={avoidText}
                onChangeText={setAvoidText}
                placeholder="如：熬夜；刷短视频"
                placeholderTextColor={theme.colors.textDim}
                multiline
              />
              <Text style={styles.hint}>不保存退出，改动丢弃</Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>近期目标</Text>
              <Text style={styles.profileValue}>
                {profile.goals.length ? profile.goals.join('；') : '未设置，点右上角铅笔补充'}
              </Text>
              <Text style={styles.label}>想少做的事</Text>
              <Text style={styles.profileValue}>
                {profile.avoid.length ? profile.avoid.join('；') : '未设置'}
              </Text>
            </>
          )}
        </View>

        {/* 分组列表 */}
        <Pressable style={styles.row} onPress={() => router.push('/settings/llm')}>
          <Text style={styles.rowLabel}>理解引擎</Text>
          <Text style={[styles.rowValue, llmStatus.warn && { color: theme.colors.red }]}>
            {llmStatus.label} ›
          </Text>
        </Pressable>

        <View style={styles.notifyCard}>
          <View style={styles.notifyRow}>
            <Text style={styles.rowLabel}>早 8:00 晨间待办</Text>
            <Switch
              value={profile.notifyMorning}
              onValueChange={(v) => toggleNotify('notifyMorning', v)}
              trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
              thumbColor={profile.notifyMorning ? theme.colors.accent : '#fff'}
            />
          </View>
          <View style={styles.notifyRow}>
            <Text style={styles.rowLabel}>晚 21:00 夜间待办</Text>
            <Switch
              value={profile.notifyEvening}
              onValueChange={(v) => toggleNotify('notifyEvening', v)}
              trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
              thumbColor={profile.notifyEvening ? theme.colors.accent : '#fff'}
            />
          </View>
        </View>

        <Pressable style={[styles.row, total === 0 && { opacity: 0.45 }]} onPress={doExport} disabled={total === 0}>
          <Text style={styles.rowLabel}>导出数据</Text>
          <Text style={styles.rowValue}>Markdown ⤴</Text>
        </Pressable>

        <View style={[styles.row, styles.rowStatic]}>
          <Text style={[styles.rowLabel, { color: theme.colors.textDim }]}>统计</Text>
          <Text style={styles.rowValue}>{total} 条 · {days} 天</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  h1: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  companion: { fontSize: theme.font.small, color: theme.colors.textDim, marginTop: -6 },
  profileCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.input,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 8,
    marginTop: 6,
  },
  profileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: theme.font.body, fontWeight: '700', color: theme.colors.text },
  label: { fontSize: theme.font.small, color: theme.colors.textDim, marginTop: 2 },
  profileValue: { fontSize: theme.font.body, color: theme.colors.text, lineHeight: 21 },
  input: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: theme.font.body,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 52,
    textAlignVertical: 'top',
  },
  inputEditing: { borderColor: theme.colors.accent, borderWidth: 2 },
  hint: { fontSize: theme.font.small, color: theme.colors.textDim, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowStatic: { backgroundColor: theme.colors.bg, borderColor: theme.colors.border },
  rowLabel: { fontSize: theme.font.body, color: theme.colors.text },
  rowValue: { fontSize: theme.font.small, color: theme.colors.textDim },
  notifyCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.input,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 2,
  },
  notifyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
});
