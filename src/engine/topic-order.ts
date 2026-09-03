import type { TopicGroup } from '../types';

/**
 * 聚合消息排序：置顶组在前；置顶区和普通区内部均按最近内容更新时间排序。
 * 返回新数组，避免改变调用方状态。
 */
export function sortTopicGroups(groups: TopicGroup[]): TopicGroup[] {
  return [...groups].sort((a, b) => {
    const aPinned = a.pinnedAt !== null;
    const bPinned = b.pinnedAt !== null;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}
