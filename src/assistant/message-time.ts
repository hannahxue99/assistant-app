const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function assistantMessageDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function shouldShowAssistantDateSeparator(
  timestamp: number,
  previousTimestamp?: number,
): boolean {
  return previousTimestamp === undefined
    || assistantMessageDayKey(timestamp) !== assistantMessageDayKey(previousTimestamp);
}

export function formatAssistantDateSeparator(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  if (assistantMessageDayKey(timestamp) === assistantMessageDayKey(now)) return '今天';
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  if (assistantMessageDayKey(timestamp) === assistantMessageDayKey(yesterday.getTime())) return '昨天';
  if (date.getFullYear() === current.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatAssistantMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
