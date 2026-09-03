import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getSettings, initDatabase } from '@/src/db';
import { migrateLegacyOnce } from '@/src/engine/migrate-legacy';
import {
  configureNotificationHandler,
  ensurePermissions,
  scheduleDailyNotifications,
} from '@/src/engine/notifications';
import { retryFailedUnderstandings } from '@/src/engine/understand';
import { theme } from '@/src/theme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
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
  const [ready, setReady] = useState(false);

  const bootstrap = useCallback(async () => {
    try {
      await configureNotificationHandler(); // Android：先建 channel，再谈权限
      await initDatabase();
      // 一次性迁移老 App 数据（已迁移/库非空时自动跳过）
      await migrateLegacyOnce();
      // 先请求权限再排通知：iOS/Android 13+ 未授权时 schedule 会静默失败
      const granted = await ensurePermissions();
      if (granted) {
        await scheduleDailyNotifications(); // 依据画像开关重挂晨晚通知（晨问逐日续期）
      }
      // 联网补理解：LLM 开启时重跑上次失败的条目（fire-and-forget）
      const settings = await getSettings();
      if (settings.llmEnabled && settings.llmKey) {
        retryFailedUnderstandings(settings).catch(() => {});
      }
      setReady(true);
    } catch (e) {
      console.warn('初始化失败', e);
      setReady(true); // 尽力而为，不让白屏
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
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
