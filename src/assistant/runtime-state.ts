export type AssistantRuntimeStage = 'thinking' | 'answering' | 'finalizing';

export function formatAssistantRuntimeDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes} 分 ${seconds} 秒`;
}

export function assistantRuntimeLabel(stage: AssistantRuntimeStage, elapsedMs: number): string {
  const action = stage === 'answering'
    ? '小知正在回答'
    : stage === 'finalizing'
      ? '小知正在整理'
      : '小知正在思考';
  return `${action} · ${formatAssistantRuntimeDuration(elapsedMs)}`;
}

export function assistantCompletedRuntimeLabel(elapsedMs: number): string {
  return `用时 ${formatAssistantRuntimeDuration(elapsedMs)}`;
}
