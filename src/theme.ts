import { Platform } from 'react-native';

/** 统一的视觉语言：暖色、克制、阅读友好 */
export const theme = {
  colors: {
    bg: '#F6F3EE',
    card: '#FFFFFF',
    border: '#E8E2D9',
    text: '#2B2622',
    textDim: '#8A837B',
    accent: '#E0733A',       // 暖橙，主要强调
    accentSoft: '#F9E8DD',
    green: '#4C8A6E',        // 完成态
    red: '#C05A4E',          // 逾期/负向
    gold: '#C99A2E',         // 提醒卡
    goldSoft: '#F8EFD9',
  },
  radius: { card: 16, pill: 20, input: 12 },
  shadow: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 2 },
    default: {},
  }),
  font: {
    title: 22,
    heading: 17,
    body: 15,
    small: 13,
  },
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
