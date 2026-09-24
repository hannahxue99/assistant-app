import { Platform } from 'react-native';

/** 统一的视觉语言：暖色、克制、阅读友好 */
export const theme = {
  colors: {
    bg: '#FFF9F4',
    card: '#FFFFFF',
    tabBar: '#FFFCF9',
    border: '#EEE8E2',
    text: '#241F1B',
    textDim: '#948B84',
    accent: '#EC6B2D',       // 暖橙，主要强调
    accentDark: '#C6531F',
    accentSoft: '#FFF0E5',
    accentMist: '#FFF6EE',
    green: '#4C8A6E',        // 完成态
    greenSoft: '#ECF7F0',
    violet: '#6657D9',
    violetSoft: '#F0EEFF',
    red: '#C05A4E',          // 逾期/负向
    gold: '#C99A2E',         // 提醒卡
    goldSoft: '#F8EFD9',
    eventBorder: '#E2C77F',
    eventSoft: '#FFFCF3',
  },
  radius: { card: 20, pill: 24, input: 16 },
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 },
  touchTarget: 44,
  shadow: Platform.select({
    ios: { shadowColor: '#8A5B3D', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 2 },
    default: {},
  }),
  font: {
    title: 32,
    heading: 20,
    body: 16,
    small: 13,
  },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' } as const,
};

export type KindMeta = {
  label: string;
  color: string;
};

/** 意图类型的中文标注与配色 */
export const KIND_META: Record<'task' | 'idea' | 'info', KindMeta> = {
  task: { label: '待办', color: theme.colors.accent },
  idea: { label: '想法', color: theme.colors.gold },
  info: { label: '信息', color: theme.colors.green },
};
