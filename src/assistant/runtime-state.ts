export type AssistantRuntimeStage = 'reading' | 'planning' | 'updating' | 'answering' | 'finalizing';

export function formatAssistantRuntimeDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes} 分 ${seconds} 秒`;
}

export function assistantRuntimeLabel(stage: AssistantRuntimeStage, elapsedMs: number): string {
  const action = stage === 'reading'
    ? '小知正在读取事件和待办'
    : stage === 'planning'
      ? '小知正在整理处理方案'
      : stage === 'updating'
        ? '小知正在更新'
        : stage === 'answering'
          ? '小知正在回答'
          : '小知正在整理';
  return `${action} · ${formatAssistantRuntimeDuration(elapsedMs)}`;
}

export function assistantCompletedRuntimeLabel(elapsedMs: number): string {
  return `用时 ${formatAssistantRuntimeDuration(elapsedMs)}`;
}
