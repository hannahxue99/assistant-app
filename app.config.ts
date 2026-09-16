import type { ConfigContext, ExpoConfig } from 'expo/config';

type AppVariant = 'development' | 'production';

const DEVELOPMENT_VARIANT = 'development';
const PRODUCTION_VARIANT = 'production';
const APPLE_TEAM_ID = 'UMP8R97X9B';

export function resolveAppVariant(value = process.env.APP_VARIANT): AppVariant {
  const variant = value ?? PRODUCTION_VARIANT;

  if (variant !== DEVELOPMENT_VARIANT && variant !== PRODUCTION_VARIANT) {
    throw new Error(`Unsupported APP_VARIANT: ${variant}`);
  }

  return variant;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveAppVariant();
  const isDevelopment = variant === DEVELOPMENT_VARIANT;

  return {
    ...config,
    name: isDevelopment ? '私人助手 Dev' : '私人助手',
    slug: config.slug ?? 'assistant-app',
    icon: isDevelopment
      ? './assets/images/icon-dev.png'
      : './assets/images/icon.png',
    scheme: isDevelopment ? 'assistantapp-dev' : 'assistantapp',
    ios: {
      ...config.ios,
      appleTeamId: APPLE_TEAM_ID,
      bundleIdentifier: isDevelopment
        ? 'com.huanxue.assistantapp.dev'
        : 'com.huanxue.assistantapp',
    },
    android: {
      ...config.android,
      package: isDevelopment
        ? 'com.anonymous.assistantapp.dev'
        : 'com.anonymous.assistantapp',
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-dev-client',
        {
          addGeneratedScheme: isDevelopment,
        },
      ],
      './plugins/with-local-notifications-only',
    ],
  };
};
