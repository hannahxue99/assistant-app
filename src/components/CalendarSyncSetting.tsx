import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { calendarAccounts, calendarStatus, setCalendarEnabled, syncCalendar } from '../engine/calendar-sync';
import { theme } from '../theme';

type CalendarSyncSettingProps = {
  embedded?: boolean;
  topDividerStyle?: StyleProp<ViewStyle>;
};

export function CalendarSyncSetting({ embedded = false, topDividerStyle }: CalendarSyncSettingProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof calendarStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { void calendarStatus().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
  if (Platform.OS !== 'ios') return null;

  async function enable(sourceId?: string) {
    setBusy(true);
    try { await setCalendarEnabled(true, sourceId); await syncCalendar(true); }
    catch (e) { Alert.alert('日历未同步', e instanceof Error ? e.message : '请稍后重试', [
      { text: '好' }, { text: '去设置', onPress: () => { void Linking.openSettings(); } },
    ]); }
    finally { setBusy(false); refresh(); }
  }
  async function chooseAccount() {
    setBusy(true);
    try {
      if (status?.calendar_id) { await enable(); return; }
      const accounts = await calendarAccounts();
      if (!accounts.length) throw new Error('没有可写入的日历账户，请先在苹果日历中配置账户。');
      Alert.alert('选择日历账户', '将在此账户新建私人助手专用日历；iCloud账户中的日程可能同步到你的其他设备。', [
        ...accounts.map(a => ({ text: a.name, onPress: () => { void enable(a.id); } })),
        { text: '取消', style: 'cancel' as const },
      ]);
    } catch (e) { Alert.alert('日历未同步', e instanceof Error ? e.message : '请重试', [
      { text: '好' }, { text: '去设置', onPress: () => { void Linking.openSettings(); } },
    ]); }
    finally { setBusy(false); }
  }
  function toggle(value: boolean) {
    if (value) {
      Alert.alert('同步到苹果日历', '同步今天及未来未完成的有日期待办。之后修改和删除会同步更新日程，以私人助手为准。完成的日程保留并标记✓。', [
        { text: '取消', style: 'cancel' }, { text: '继续', onPress: () => { void chooseAccount(); } },
      ]);
    } else {
      setBusy(true);
      void setCalendarEnabled(false).catch(() => Alert.alert('关闭失败', '请重试')).finally(() => { setBusy(false); refresh(); });
    }
  }
  return <View style={[styles.card, embedded && styles.embeddedCard, topDividerStyle]}>
    <View style={styles.row}><Text style={styles.title}>同步到苹果日历</Text>
      <Switch accessibilityLabel="同步到苹果日历" disabled={busy || !status} value={!!status?.enabled} onValueChange={toggle} />
    </View>
    <Text style={styles.detail}>{busy ? '正在设置…' : !status?.enabled ? '关闭后保留已有日程' : status.error ? '日历未同步' : status.pending ? `待同步 ${status.pending} 条` : '已同步 · 私人助手专用日历'}</Text>
    {!!status?.error && !!status.enabled && <>
      <Text style={styles.detail}>{status.error}</Text>
      <View style={styles.row}>
        <Pressable style={styles.action} onPress={() => { void syncCalendar(true).then(refresh).catch(refresh); }}><Text style={styles.link}>重试</Text></Pressable>
        <Pressable style={styles.action} onPress={() => { void Linking.openSettings(); }}><Text style={styles.link}>去设置</Text></Pressable>
      </View>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.card, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, gap: 4 },
  embeddedCard: { borderRadius: 0, minHeight: theme.touchTarget },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: theme.font.body, color: theme.colors.text }, detail: { fontSize: 12, lineHeight: 18, color: theme.colors.textDim },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, link: { color: theme.colors.accent, fontSize: 15 },
});
