import { selectMemoryContext } from './memory-context';
import { listActiveMemories, listMemoryCandidates } from './memory-store';
import type { AssistantMemoryContext } from './memory-types';

export async function loadAssistantMemoryContext(query: string): Promise<AssistantMemoryContext> {
  const [active, candidates] = await Promise.all([
    listActiveMemories(200),
    listMemoryCandidates(200),
  ]);
  return selectMemoryContext(query, active, candidates);
}
