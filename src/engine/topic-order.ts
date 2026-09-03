import type { TopicGroup } from '../types';

/**
 * 聚合消息排序：置顶组在前，按最近置顶排序；普通组按最新消息排序。
 * 返回新数组，避免改变调用方状态。
 */
export function sortTopicGroups(groups: TopicGroup[]): TopicGroup[] {
  return [...groups].sort((a, b) => {
    const aPinned = a.pinnedAt !== null;
    const bPinned = b.pinnedAt !== null;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (aPinned && bPinned && a.pinnedAt !== b.pinnedAt) {
      return b.pinnedAt! - a.pinnedAt!;
    }
    return b.updatedAt - a.updatedAt;
  });
}
