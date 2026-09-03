import type { Entry } from '../types';

const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_BANNER_THRESHOLD = 3;

/** 最近一段时间出现多条理解失败时，升级为页面级提示。 */
export function shouldShowUnderstandingFailureBanner(
  entries: Pick<Entry, 'parseStatus' | 'createdAt'>[],
  now = Date.now(),
): boolean {
  const cutoff = now - FAILURE_WINDOW_MS;
  return entries.filter((entry) => (
    entry.parseStatus === 'failed'
    && entry.createdAt >= cutoff
    && entry.createdAt <= now
  )).length >= FAILURE_BANNER_THRESHOLD;
}

