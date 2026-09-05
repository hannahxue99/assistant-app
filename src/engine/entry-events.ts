const host = globalThis as typeof globalThis & { __entryListeners?: Set<() => void> };
const listeners = host.__entryListeners ??= new Set();
export function subscribeEntryChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyEntryChanges(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* UI listener must not affect persisted results. */ }
  }
}
