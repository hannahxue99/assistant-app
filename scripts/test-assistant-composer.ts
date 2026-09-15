import {
  assistantComposerMode,
  canSendAssistantComposer,
  joinAssistantComposerText,
} from '../src/assistant/composer-state';

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

console.log('assistant composer state tests passed');
