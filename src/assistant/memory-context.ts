import { estimateAssistantTokens } from './token-budget';
import type { AssistantMemory, AssistantMemoryContext } from './memory-types';

const ACTIVE_LIMIT = 12;
const ACTIVE_TOKEN_BUDGET = 800;
const CANDIDATE_LIMIT = 3;

function grams(value: string): Set<string> {
  const compact = value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  const result = new Set<string>();
  for (let index = 0; index < compact.length; index += 1) {
    result.add(compact[index]);
    if (index + 1 < compact.length) result.add(compact.slice(index, index + 2));
  }
  return result;
}

function relevance(query: string, memory: AssistantMemory): number {
  const queryGrams = grams(query);
  if (!queryGrams.size) return 0;
  const memoryGrams = grams(memory.content);
  let overlap = 0;
  for (const gram of queryGrams) if (memoryGrams.has(gram)) overlap += gram.length;
  return overlap / Math.max(1, queryGrams.size + memoryGrams.size);
}

function selectActive(query: string, memories: AssistantMemory[]): AssistantMemory[] {
  const ranked = memories
    .map(memory => ({ memory, score: relevance(query, memory) }))
    .filter(item => item.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.memory.updatedAt - left.memory.updatedAt
      || right.memory.id.localeCompare(left.memory.id)
    ))
    .map(item => item.memory);
  const selected: AssistantMemory[] = [];
  let tokens = 0;
  for (const memory of ranked) {
    if (selected.length >= ACTIVE_LIMIT) break;
    const next = estimateAssistantTokens(`${memory.category}:${memory.content}`) + 4;
    if (tokens + next > ACTIVE_TOKEN_BUDGET) continue;
    selected.push(memory);
    tokens += next;
  }
  return selected;
}

export function selectMemoryContext(
  query: string,
  active: AssistantMemory[],
  candidates: AssistantMemory[],
): AssistantMemoryContext {
  const selectedCandidates = [...candidates]
    .map(memory => ({ memory, score: relevance(query, memory) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, CANDIDATE_LIMIT)
    .map(item => item.memory);
  return { active: selectActive(query, active), candidates: selectedCandidates };
}
