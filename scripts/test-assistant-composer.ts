import {
  assistantComposerMode,
  canSendAssistantComposer,
  joinAssistantComposerText,
} from '../src/assistant/composer-state';
import {
  normalizeVoiceLevel,
  smoothVoiceLevel,
  voiceLevelBarHeights,
} from '../src/assistant/voice-level';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(joinAssistantComposerText('', '明天吃苹果') === '明天吃苹果', '空输入应直接回显语音文字');
check(
  joinAssistantComposerText('帮我记一下', '明天吃苹果') === '帮我记一下 明天吃苹果',
  '已有文字和语音转写之间应自动补空格',
);
check(joinAssistantComposerText('  帮我记一下  ', '  ') === '帮我记一下', '空白转写不得污染已有文字');

check(
  assistantComposerMode({ text: '', listening: false, unavailable: false }) === 'idle',
  '空输入应为闲置态',
);
check(
  assistantComposerMode({ text: '你好', listening: false, unavailable: false }) === 'input',
  '有文字应为输入态',
);
check(
  assistantComposerMode({ text: '你好', listening: true, unavailable: false }) === 'listening',
  '语音识别应优先显示收音态',
);
check(
  assistantComposerMode({ text: '不会显示', listening: true, unavailable: true }) === 'processing',
  '处理期间应优先显示锁定态',
);

check(
  canSendAssistantComposer({ text: '你好', listening: false, unavailable: false }),
  '正常文字应允许发送',
);
check(
  !canSendAssistantComposer({ text: '', listening: false, unavailable: false }),
  '空内容不得发送',
);
check(
  !canSendAssistantComposer({ text: '正在说', listening: true, unavailable: false }),
  '语音识别中不得提前发送',
);
check(
  !canSendAssistantComposer({ text: '等待中', listening: false, unavailable: true }),
  '等待回复时不得发送第二条消息',
);

check(normalizeVoiceLevel(-2) === 0, '不可听音量应归零');
check(normalizeVoiceLevel(5) === 0.5, '中等音量应归一化');
check(normalizeVoiceLevel(12) === 1, '超出范围的音量应封顶');
check(normalizeVoiceLevel(Number.NaN) === 0, '非法音量不得污染 UI');

const risingLevel = smoothVoiceLevel(0.1, 8);
const fallingLevel = smoothVoiceLevel(0.8, 0);
check(risingLevel > 0.5 && risingLevel <= 1, '说话时波动条应快速上升');
check(fallingLevel > 0 && fallingLevel < 0.8, '停顿时波动条应平滑回落');

const silentBars = voiceLevelBarHeights(0);
const loudBars = voiceLevelBarHeights(1);
check(silentBars.length === 5 && silentBars.every(height => height === 4), '静音时应保留五根最小提示条');
check(loudBars[2] === 24 && loudBars[2] > loudBars[0], '高音量时中间波动条应最明显');

console.log('assistant composer state tests passed');
