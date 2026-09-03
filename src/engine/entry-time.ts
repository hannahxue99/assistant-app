import type { Entry } from '../types';

/** 内容活动时间：新记录与创建时间相同，用户修改后取最后编辑时间。 */
export function entryActivityAt(entry: Pick<Entry, 'updatedAt'>): number {
  return entry.updatedAt;
}

/** 仅真实发生过内容修改时展示“编辑”时间。 */
export function wasEntryEdited(entry: Pick<Entry, 'createdAt' | 'updatedAt'>): boolean {
  return entry.updatedAt > entry.createdAt;
}
