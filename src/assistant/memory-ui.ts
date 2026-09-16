export type MemorySectionState = 'loading' | 'error' | 'empty' | 'ready';

export function memorySectionState(input: {
  loadedOnce: boolean;
  loading: boolean;
  error: boolean;
  memoryCount: number;
}): MemorySectionState {
  if (!input.loadedOnce && input.loading) return 'loading';
  if (!input.loadedOnce && input.error) return 'error';
  return input.memoryCount > 0 ? 'ready' : 'empty';
}

export function canSaveMemoryEdit(original: string, draft: string, busy: boolean): boolean {
  const normalizedOriginal = original.trim().replace(/\s+/g, ' ');
  const normalizedDraft = draft.trim().replace(/\s+/g, ' ');
  return !busy && normalizedDraft.length > 0 && normalizedDraft.length <= 200
    && normalizedDraft !== normalizedOriginal;
}
