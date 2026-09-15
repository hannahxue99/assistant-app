import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { syncCalendar } from '@/src/engine/calendar-sync';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  clearPendingNotificationSync,
  getSettings,
  initDatabase,
  listPendingNotificationSyncEntries,
} from '@/src/db';
import {
  configureNotificationHandler,
  ensurePermissions,
  refreshTaskDrivenNotifications,
  syncEntryReminders,
} from '@/src/engine/notifications';
import { retryFailedUnderstandings } from '@/src/engine/understand';
import { migrateLegacyEntriesToAssistantHistory } from '@/src/assistant/migration';
import { migrateLegacyTopicsToEvents } from '@/src/assistant/event-migration';
import { recoverInterruptedAssistantRequests } from '@/src/assistant/store';
import { theme } from '@/src/theme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

const assistantStartupRuntime = globalThis as typeof globalThis & {
  __assistantPendingRecoveryComplete?: boolean;
};

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.bg,
    primary: theme.colors.accent,
    card: theme.colors.card,
    border: theme.colors.border,
    text: theme.colors.text,
  },
};

export default function RootLayout() {
  const [startupState, setStartupState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [startupAttempt, setStartupAttempt] = useState(0);

  const bootstrap = useCallback(async () => {
    setStartupState('loading');
    try {
      await initDatabase();
      if (!assistantStartupRuntime.__assistantPendingRecoveryComplete) {
        await recoverInterruptedAssistantRequests();
        assistantStartupRuntime.__assistantPendingRecoveryComplete = true;
      }
      try {
        await migrateLegacyEntriesToAssistantHistory();
      } catch (e) {
        // 旧表仍是事实来源；迁移失败不阻塞 App，下次启动从未迁移条目继续。
        console.warn('旧原声迁移未完成，将在下次启动续跑', e);
      }
      try {
        await migrateLegacyTopicsToEvents();
      } catch (e) {
        // 旧 topic/entries 仍完整保留；事件迁移按主题幂等，下次启动可继续。
        console.warn('旧主题迁移未完成，将在下次启动续跑', e);
      }
      setStartupState('ready');
    } catch (e) {
      console.warn('数据库初始化失败', e);
      setStartupState('error');
      return;
    }

    // 通知与联网补理解都不是打开本地记录的前置条件，失败时不阻塞主界面。
    try {
      await configureNotificationHandler(); // Android：先建 channel，再谈权限
      // 先请求权限再排通知：iOS/Android 13+ 未授权时 schedule 会静默失败
      const granted = await ensurePermissions();
      if (granted) {
        await refreshTaskDrivenNotifications(); // 与任务变化共用串行队列
        const pendingReminderEntries = await listPendingNotificationSyncEntries();
        if (pendingReminderEntries.length > 0) {
          await syncEntryReminders(pendingReminderEntries);
          await clearPendingNotificationSync(pendingReminderEntries.map((entry) => entry.id));
        }
      }
    } catch (e) {
      console.warn('通知同步失败，将在下次启动时重试', e);
    }
    try {
      // 通知失败也必须继续补理解。
      const settings = await getSettings();
      if (settings.llmEnabled && settings.llmKey) {
        retryFailedUnderstandings(settings).catch(() => {});
      }
    } catch (e) {
      console.warn('启动后的后台同步失败，将在下次启动时重试', e);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap, startupAttempt]);

  useEffect(() => {
    if (startupState !== 'ready') return;
    const sync = (reconcile = false) => { void syncCalendar(reconcile).catch(() => {}); };
    sync(true);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') sync(true); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') sync(); }, 5000);
    return () => { listener.remove(); clearInterval(timer); };
  }, [startupState]);

  if (startupState === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }

  if (startupState === 'error') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.errorPage}>
          <View style={styles.errorContent}>
            <View style={styles.errorIcon}>
              <Ionicons name="server-outline" size={30} color={theme.colors.accent} />
            </View>
            <Text style={styles.errorTitle}>数据暂时无法加载</Text>
            <Text style={styles.errorDescription}>
              请重新尝试。你的记录仍保存在本机，不会因为本次加载失败而丢失。
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新尝试加载数据"
              onPress={() => setStartupAttempt((attempt) => attempt + 1)}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            >
              <Text style={styles.retryButtonText}>重新尝试</Text>
            </Pressable>
            <Text style={styles.errorHint}>如果仍无法打开，请完全关闭 App 后重新进入</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider value={appTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorPage: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  errorContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 56,
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accentSoft,
    marginBottom: 22,
  },
  errorTitle: {
    color: theme.colors.text,
    fontSize: theme.font.title,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: theme.spacing.sm,
  },
  errorDescription: {
    maxWidth: 300,
    color: theme.colors.textDim,
    fontSize: theme.font.body,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 30,
  },
  retryButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  retryButtonPressed: {
    opacity: 0.78,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: theme.font.body,
    fontWeight: theme.fontWeight.semibold,
  },
  errorHint: {
    color: theme.colors.textDim,
    fontSize: theme.font.small,
    textAlign: 'center',
    marginTop: 18,
  },
});
