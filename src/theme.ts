import { Platform } from 'react-native';

/** 统一的视觉语言：雾白、墨黑、克制的环境智能感 */
export const theme = {
  colors: {
    bg: '#F7F7F5',
    ink: '#111318',
    graphite: '#6F737B',
    fog: '#EEF0F2',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    border: '#D9DCDE',
    divider: '#E3E5E6',
    text: '#111318',
    textDim: '#6F737B',
    accent: '#E9783D',       // 小知人格色，不承担全局选中态
    accentSoft: '#F8ECE6',
    green: '#4C8A6E',        // 完成态
    red: '#C05A4E',          // 逾期/负向
    gold: '#C99A2E',         // 提醒卡
    goldSoft: '#F8EFD9',
    eventBorder: '#E2C77F',
    eventSoft: '#FFFCF3',
  },
  radius: { card: 16, pill: 20, input: 12 },
  spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 },
  touchTarget: 44,
  shadow: Platform.select({
    ios: { shadowColor: '#111318', shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 2 },
    default: {},
  }),
  font: {
    title: 22,
    heading: 17,
    body: 15,
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
