import type { AssistantMessage } from './types';

/** 合并刷新页和历史页；以 id 去重，以更新时间较新的状态覆盖旧状态。 */
export function mergeAssistantMessages(
  current: AssistantMessage[],
  incoming: AssistantMessage[],
): AssistantMessage[] {
  const byId = new Map<string, AssistantMessage>();
  for (const item of [...current, ...incoming]) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => (
    left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  ));
}
