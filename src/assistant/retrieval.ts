import type { Entry } from '../types';
import type { ConversationSegment } from './types';

function normalized(text: string): string {
  return text.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function grams(text: string): Set<string> {
  const value = normalized(text);
  const result = new Set<string>();
  if (value.length <= 2) {
    if (value) result.add(value);
    return result;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

export function scoreTextRelevance(query: string, text: string): number {
  const needle = normalized(query);
  const haystack = normalized(text);
  if (!needle || !haystack) return 0;
  if (haystack.includes(needle)) return 1;
  const queryGrams = grams(query);
  const textGrams = grams(text);
  if (!queryGrams.size || !textGrams.size) return 0;
  let overlap = 0;
  for (const gram of queryGrams) if (textGrams.has(gram)) overlap += 1;
  return overlap / queryGrams.size;
}

export function rankRelevantSegments(query: string, segments: ConversationSegment[]) {
  const ranked = segments
    .map(segment => ({
      id: segment.id,
      summary: segment.summary,
      relevance: scoreTextRelevance(query, segment.summary),
      updatedAt: segment.updatedAt,
    }))
    .filter(item => item.relevance >= 0.2)
    .sort((left, right) => right.relevance - left.relevance || right.updatedAt - left.updatedAt);
  const best = ranked[0]?.relevance ?? 0;
  return ranked.filter(item => item.relevance >= Math.max(0.2, best * 0.65));
}

export function rankRelevantEntries(query: string, entries: Entry[]) {
  const ranked = entries
    .map(entry => ({
      id: entry.id,
      text: entry.rawText.trim() === entry.summary.trim()
        ? entry.summary
        : `${entry.summary}（原话：${entry.rawText}）`,
      relevance: Math.max(
        scoreTextRelevance(query, entry.summary),
        scoreTextRelevance(query, entry.rawText),
      ),
      updatedAt: entry.updatedAt,
      dedupeKey: `entry:${entry.id}`,
    }))
    .filter(item => item.relevance >= 0.2)
    .sort((left, right) => right.relevance - left.relevance || right.updatedAt - left.updatedAt);
  const best = ranked[0]?.relevance ?? 0;
  return ranked.filter(item => item.relevance >= Math.max(0.2, best * 0.65));
}
