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

/** 落定后按阶段汇总的实际耗时；缺省字段表示该阶段未发生。 */
export interface AssistantStageDurations {
  readingMs?: number;
  thinkingMs?: number;
  updatingMs?: number;
}

export interface AssistantStageTimelineEntry {
  stage: AssistantRuntimeStage;
  at: number;
}

const STAGE_DISPLAY_NAMES: Record<AssistantRuntimeStage, string> = {
  reading: '读取事件和待办',
  planning: '整理处理方案',
  updating: '更新',
  answering: '回答',
  finalizing: '整理',
};

/** 运行中已完成阶段的一行文案，如“读取事件和待办 3 秒”。 */
export function assistantStageLineLabel(stage: AssistantRuntimeStage, elapsedMs: number): string {
  return `${STAGE_DISPLAY_NAMES[stage]} ${formatAssistantRuntimeDuration(elapsedMs)}`;
}

/** 从阶段切换时间线合并出各阶段总耗时（同阶段多次出现累加，忽略回答与收尾）。 */
export function assistantStageDurationsFromTimeline(
  timeline: AssistantStageTimelineEntry[],
  endedAt: number,
): AssistantStageDurations {
  const sums = new Map<AssistantRuntimeStage, number>();
  timeline.forEach((entry, index) => {
    const next = timeline[index + 1];
    const end = next ? next.at : endedAt;
    const ms = Math.max(0, end - entry.at);
    sums.set(entry.stage, (sums.get(entry.stage) ?? 0) + ms);
  });
  const durations: AssistantStageDurations = {};
  if (sums.has('reading')) durations.readingMs = sums.get('reading');
  if (sums.has('planning')) durations.thinkingMs = sums.get('planning');
  if (sums.has('updating')) durations.updatingMs = sums.get('updating');
  return durations;
}

/**
 * 落定后的过程摘要行：只列实际发生且耗时的阶段（如“读取 3 秒 · 思考 8 秒 · 更新 1 秒”）。
 * 纯聊天轮退化为“思考了 X 秒”，与旧展示兼容。
 */
export function assistantStageSummaryLabel(
  durations: AssistantStageDurations | undefined,
  fallbackThinkingMs?: number,
): string | null {
  const parts: string[] = [];
  if (durations?.readingMs && durations.readingMs >= 1000) {
    parts.push(`读取 ${formatAssistantRuntimeDuration(durations.readingMs)}`);
  }
  const thinkingMs = durations?.thinkingMs ?? fallbackThinkingMs;
  if (thinkingMs && thinkingMs >= 1000) {
    parts.push(`思考 ${formatAssistantRuntimeDuration(thinkingMs)}`);
  }
  if (durations?.updatingMs && durations.updatingMs >= 1000) {
    parts.push(`更新 ${formatAssistantRuntimeDuration(durations.updatingMs)}`);
  }
  if (!parts.length) return null;
  if (parts.length === 1 && thinkingMs && parts[0].startsWith('思考')) {
    return `思考了 ${formatAssistantRuntimeDuration(thinkingMs)}`;
  }
  return parts.join(' · ');
}
